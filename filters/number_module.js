import parsePhoneNumber from 'libphonenumber-js'
import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import cel from "connect-ensure-login"
const __dirname = dirname(fileURLToPath(import.meta.url));
const views_path = __dirname + '/../views/';
const debug = process.env.DEBUG || false;
var ensureLoggedIn = cel.ensureLoggedIn 
//if debug, ensuredLoggedIn does nothing
if (debug){
    ensureLoggedIn = (options) => {
        return function (req, res, next) {
            next()
        };
    }
}

// function ensureLoggedIn(options) {
//   if (typeof options == 'string') {
//       options = { redirectTo: options };
//   }
//   options = options || {};

//   var url = options.redirectTo || '/login';
//   var setReturnTo = (options.setReturnTo === undefined) ? true : options.setReturnTo;

//   return function (req, res, next) {
//       if (!req.isAuthenticated || !req.isAuthenticated()) {
//           if (setReturnTo && req.session) {
//               req.session.returnTo = req.originalUrl || req.url;
//           }
//           res.clearCookie('session', {path: '/'});
//           return res.redirect(301, url);
//       }
//       next();
//   };
// };
//octopusdb password: B9FN5thmgloOjStDxnrB

export function NumberModule(state, pool){
  this.router = express.Router();
  
  this.blacklist_from = async function (req, res, next){
    var prefix = req.body.api_key
    var disabled = await state.get(prefix+"numbers_conf_disabled");
    if (!disabled){disabled= [];}
    else{disabled = (JSON.parse(disabled))}
    if(disabled.includes("blacklist_from")){return next()} //if this filter is in disabled list, skip it
    state.get(prefix+"number_blacklist").then((nblacklist) => {
        if (!nblacklist) {
          next();
        }
        else {
          const phoneNumber = parsePhoneNumber("+" + (req.body.from));
          nblacklist = JSON.parse(nblacklist);
          var number = parseInt(phoneNumber.number.replace("+",""))

          for (const nrange of nblacklist) {
            console.log(nrange)
            if(number >= nrange[0] && number <= nrange[1]){
              res.status(200).json({"allowed":false,"message":"number in Black List"});
              return
            }
          }
          // nblacklist.forEach(nrange => {
            
          // });
          next();
        }
    });

  }

  this.whitelist_from = async function (req, res, next){
    var prefix = req.body.api_key
    var disabled = await state.get(prefix+"numbers_conf_disabled");
    if (!disabled){disabled= [];}
    else{disabled = (JSON.parse(disabled))}
    if(disabled.includes("whitelist_from")){return next()} //if this filter is in disabled list, skip it

    state.get(prefix+"number_whitelist").then((nwhitelist) => {
        console.log("whitelist", nwhitelist )
        if (!nwhitelist) {
          next();
        }
        else {
          const phoneNumber = parsePhoneNumber("+" + (req.body.from));
          nwhitelist = JSON.parse(nwhitelist);
          var number = parseInt(phoneNumber.number.replace("+",""))
          for (const nrange of nwhitelist) {
            console.log(nrange)
            if(number >= nrange[0] && number <= nrange[1]){
              res.json({"allowed":true,"message":"number in White List"});
              return
            }
          }
          next();
        }
    });

  }

  this.auto_block_duration = async function (req, res, next){
    var prefix = req.body.api_key
    var disabled = await state.get(prefix+"numbers_conf_disabled");
    if (!disabled){disabled= [];}
    else{disabled = (JSON.parse(disabled))}
    if(disabled.includes("auto_block_duration")){return next()} //if this filter is in disabled list, skip it
   
    state.get(prefix+"lt_auto_blacklist_threshold").then(async (data) => {
      console.log(":>>>>", data)
      if (!data) {
        console.log("No Auto Rate Threshold")
        next();
      }
      else{
        if (!req.body.from) {next()}
        var threshold = JSON.parse(data);
        var range = parseInt(threshold["range"])||0
        var time = threshold["time"]||0
        var lock_time = threshold["lock_time"]||0
        var limit = threshold["limit"]||9999999
        var number_start = 0;
        var number_end = 0;
        var calc = req.body.from
        if (range>0){
          calc = req.body.from.slice(0,(range*-1))+("_".repeat(range))
          number_start = req.body.from.slice(0,(range*-1))+("0".repeat(range))
          number_end = req.body.from.slice(0,(range*-1))+("9".repeat(range))
        }
        
        const check_query = `select count(id) from time_blocked where api_key = '${prefix}' and number_start <= ${number_start} and number_end >= '${number_end}' and now() <= blocked_until`
        console.log("check_query_", check_query)
        const check_result = await pool.query(check_query)
        console.log(check_result.rows[0])
        var check_count = check_result.rows[0]['count']

        if (check_count >=1) {
          console.log("Check count more than 1")
          return res.json({"allowed":false,"message":"number range in timed block"});
        }
        else{
          try {
            const check_threshold_query = `select count(id) from octopuslog where data_from like '${calc}' and api_key = '${prefix}' and  created_at between now() - interval '${time} seconds' and now() and used_in_block = false;`
            console.log(check_threshold_query)
            const result = await pool.query(check_threshold_query)
            console.log(result.rows[0])
            var count = result.rows[0]['count']
            if (count >= parseInt(limit)){
              const insert_query = `insert into time_blocked (api_key, number_start, number_end, blocked_until) select '${prefix}', '${number_start}', '${number_end}', now() + '${lock_time} seconds' WHERE NOT EXISTS (SELECT id FROM time_blocked WHERE api_key = '${prefix}' and number_start = '${number_start}' and number_end = '${number_end}' and created_at >  now() - interval '3 seconds');`
              const update_query =  `update octopuslog set used_in_block = true where id in (select id from octopuslog where data_from like '${calc}' and api_key = '${prefix}' and  created_at between now() - interval '${time} seconds' and now() and used_in_block = false)`
              console.log(insert_query)
              await pool.query(insert_query)
              pool.query(update_query)
              res.json({"allowed":false,"message":"number range in timed block"});

              return
            }
          } catch (err) {
            console.log(err)
            next();
          }
          next()
        }

      }
    });
    
  };


  this.auto_rate_block = async function (req, res, next){
    var prefix = req.body.api_key
    var disabled = await state.get(prefix+"numbers_conf_disabled");
    if (!disabled){disabled= [];}
    else{disabled = (JSON.parse(disabled))}
    if(disabled.includes("auto_rate_block")){return next()} //if this filter is in disabled list, skip it

    state.get(prefix+"auto_blacklist_threshold").then(async (data) => {
      if (!data) {
        console.log("No Auto Rate Threshold")
        next();
      }
      else{
        if (!req.body.from) {next()}
        var threshold = JSON.parse(data);
        var range = parseInt(threshold["range"])||0
        var time = threshold["time"]||0
        var limit = threshold["limit"]||9999999

        var calc = req.body.from
        if (range>0) calc = req.body.from.slice(0,(range*-1))+("_".repeat(range))
        
        

        try {
          const text = `select count(id) from octopuslog where data_from like '${calc}' and api_key = '${prefix}' and  created_at between now() - interval '${time} seconds' and now();`
          console.log(text)
          const result = await pool.query(text)
          console.log(result.rows[0])
          var count = result.rows[0]['count']
          if (count >= parseInt(limit)){
            res.json({"allowed":false,"message":"number range in auto limit list"});
            return
          }
        } catch (err) {
          console.log(err)
          next();
        }
        next()
      }
      
    });
    
  };

  this.router.get("/login_redirect",  async (req, res, next) => {
    var newPath = req.originalUrl.split('numbers')[1]
    res.status(302).redirect(301, '../login');
  });

  //Load Conf page
  //this.router.get('/conf', async (req, res, next) => {
  this.router.get('/conf', ensureLoggedIn({ redirectTo: '../login' }), async (req, res, next) => {
    //use consolidate js to load ejs file since we don't have access to express
    var prefix = "octo"
    if (req.user){
        prefix=req.user.username
    }
    var auto_blacklist_threshold = await state.get(prefix+"lt_auto_blacklist_threshold");
    if (!auto_blacklist_threshold){auto_blacklist_threshold= {"range":0,"limit":0,"time":0,"lock_time":0};}
    else{auto_blacklist_threshold = JSON.parse(auto_blacklist_threshold) }

    var threshold = await state.get(prefix+"auto_blacklist_threshold");
    if (!threshold){threshold= {"range":0,"limit":0,"time":0};}
    else{threshold = JSON.parse(threshold) }

    var numblacklist = await state.get(prefix+"number_blacklist");
    if (!numblacklist) numblacklist = "[]";
    numblacklist = JSON.parse(numblacklist);

    var numwhitelist = await state.get(prefix+"number_whitelist");
    if (!numwhitelist) numwhitelist = "[]";
    numwhitelist = JSON.parse(numwhitelist);

    var mods_disabled = await state.get(prefix+"numbers_conf_disabled");
    if (!mods_disabled){mods_disabled= "[]";}

    console.log(threshold)
    res.render(views_path + "number_conf.ejs", { num_blacklist: numblacklist, num_whitelist: numwhitelist, user: prefix, threshold: threshold, auto_blacklist_threshold: auto_blacklist_threshold, modules_disabled: mods_disabled })
    //console.log(req)
    //res.render(views_path + "conf.ejs", { blacklist_selected: blacklist_selected, blacklist_with_name: blacklist_with_name, user: "test"})
  });

  //Get Blacklist
  this.router.get('/get_auto_blacklist', async (req, res, next) => {
    var prefix = "octo"
    if (req.user){
        prefix=req.user.username
    }
    var threshold = await state.get(prefix+"auto_blacklist_threshold");
    if (!threshold){threshold= {"range":0,"limit":0,"time":0};}
    else{threshold = (JSON.parse(threshold))}
    console.log("ThresholdFilter", threshold)
    var range = threshold.range||0
    var time = threshold.time||0
    var limit = threshold.limit||9999999

    const threshold_query = `SELECT concat(left(data_from, length(data_from) - ${range}),'${("_".repeat(range))}') as range, count(created_at)  FROM octopuslog where api_key = '${prefix}' and created_at between now() - interval '${time} seconds' and now()   group by range having count(created_at) >=${limit}  order by count(created_at) desc`
    const auto_query = `select id, number_start, number_end, blocked_until from time_blocked where api_key = '${prefix}' and now() <= blocked_until`
    console.log(threshold_query, auto_query)
    try {
      const result = await pool.query(threshold_query)
      console.log(result.rows[0])

      
      const check_result = await pool.query(auto_query)
      console.log(check_result.rows[0])


      res.json({"threshold_result":result.rows,"auto_result": check_result.rows,"range_modifier":range})
      return
    } catch (err) {
      console.log(err)
    }
  });

  //Delete from auto Blacklist
  this.router.post('/delete_from_auto', async (req, res, next) => {
    var prefix = "octo"
    if (req.user){
        prefix=req.user.username
    }
    var id = req.body.data.id
    const delete_query = `delete from time_blocked where api_key = '${prefix}' and id = ${id}`
    try {
      const result = await pool.query(delete_query)
      console.log(result.rows[0])
      res.json({"deleted":id,"from": "Auto Block List"})
      return
    } catch (err) {
      console.log(err)
    }

  });

  //Set Blacklist
  this.router.post('/set_blacklist', async (req, res, next) => {
    var prefix = "octo"
    if (req.user){
        prefix=req.user.username
    }
    
    var blacklist = JSON.parse(req.body.data)
    if (!blacklist) blacklist = [];
    await state.set(prefix+"number_blacklist", JSON.stringify(blacklist));
    res.status(200).send(blacklist)
  });
  
  //Set Blacklist
  this.router.post('/set_whitelist', async (req, res, next) => {
    var prefix = "octo"
    if (req.user){
        prefix=req.user.username
    }
    console.log("User",prefix)
    var whitelist = JSON.parse(req.body.data)
    if (!whitelist) whitelist = [];
    await state.set(prefix+"number_whitelist", JSON.stringify(whitelist));
    res.status(200).send(whitelist)
  });

  //Set Range
  this.router.post('/set_threshold', async (req, res, next) => {
    if(!req.body.time) {
      res.status(400).send('Required Time Param missing');
      return
    }
    var time = req.body.time
    if(!req.body.range) {
      res.status(400).send('Required Range Param missing');
      return
    }
    var range = req.body.range
    if(!req.body.limit) {
      res.status(400).send('Required Limit Param missing');
      return
    }
    var limit = req.body.limit
    var prefix = "octo"
    if (req.user){
        prefix=req.user.username
    }
    console.log("SetThresholdUser",prefix+"auto_blacklist_threshold")
    var data = {"time":time,"range":range, "limit":limit}
    await state.set(prefix+"auto_blacklist_threshold", JSON.stringify(data));
    res.status(200).send(data)
  });

  //Set Range
  this.router.post('/lt_set_threshold', async (req, res, next) => {
    if(!req.body.time) {
      res.status(400).send('Required Time Param missing');
      return
    }
    var time = req.body.time
    if(!req.body.range) {
      res.status(400).send('Required Range Param missing');
      return
    }
    var range = req.body.range
    if(!req.body.limit) {
      res.status(400).send('Required Limit Param missing');
      return
    }
    var limit = req.body.limit
    if(!req.body.lock_time) {
      res.status(400).send('Required Lock Time Param missing');
      return
    }
    var lock_time = req.body.lock_time
    var prefix = "octo"
    if (req.user){
        prefix=req.user.username
    }
    console.log("SetThresholdUser",prefix+"lt_auto_blacklist_threshold")
    var data = {"time":time,"range":range, "limit":limit, "lock_time":lock_time}
    await state.set(prefix+"lt_auto_blacklist_threshold", JSON.stringify(data));
    res.status(200).send(data)
  });

  //get Range
  this.router.get('/get_threshold', async (req, res, next) => {
    var prefix = "octo"
    if (req.user){
        prefix=req.user.username
    }
    console.log("GetThresholdUser",prefix+"auto_blacklist_threshold")
    var threshold = await state.get(prefix+"auto_blacklist_threshold");
    res.status(200).json(JSON.parse(threshold))
  });

  this.router.get('/lt_get_threshold', async (req, res, next) => {
    var prefix = "octo"
    if (req.user){
        prefix=req.user.username
    }
    console.log("GetThresholdUser",prefix+"lt_auto_blacklist_threshold")
    var threshold = await state.get(prefix+"lt_auto_blacklist_threshold");
    res.status(200).json(JSON.parse(threshold))
  });

  // Home page route.
  this.router.get("/", function (req, res) {
    res.send("Wiki home page");
  });

  this.router.post('/enable_module', async (req, res, next) => {
    if(!req.body.module_name) {
      res.status(400).send('Required module_name Param missing');
      return
    }
    var module = req.body.module_name
    var prefix = "octo"
    if (req.user){
        prefix=req.user.username
    }
    var disabled = await state.get(prefix+"numbers_conf_disabled");
    if (!disabled){disabled= [];}
    else{disabled = (JSON.parse(disabled))}

    const index = disabled.indexOf(module);
    if (index > -1) { // only splice array when item is found
      disabled.splice(index, 1); // 2nd parameter means remove one item only
    }

    await state.set(prefix+"numbers_conf_disabled", JSON.stringify(disabled));
    return res.json(disabled)
    // var res = await state.get(prefix+"numbers_conf_disabled");
    // console.log(res)
  });

  this.router.post('/disable_module', async (req, res, next) => {
    if(!req.body.module_name) {
      res.status(400).send('Required module_name Param missing');
      return
    }
    var module = req.body.module_name
    var prefix = "octo"
    if (req.user){
        prefix=req.user.username
    }
    var disabled = await state.get(prefix+"numbers_conf_disabled");
    if (!disabled){disabled= [];}
    else{disabled = (JSON.parse(disabled))}

    const index = disabled.indexOf(module);
    if (index == -1) { 
      disabled.push(module); 
    }

    await state.set(prefix+"numbers_conf_disabled", JSON.stringify(disabled));
    return res.json(disabled)
    // var res = await state.get(prefix+"numbers_conf_disabled");
    // console.log(res)
  });
  
  // About page route.
  this.router.get("/about", function (req, res) {
    res.send("About this wiki");
  });
}