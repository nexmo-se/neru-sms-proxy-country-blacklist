import { neru, State } from "neru-alpha";
import hpm from "http-proxy-middleware";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import express from "express";
import isoCountry from "i18n-iso-countries";
import cons from "consolidate";
import cel from "connect-ensure-login";
import csrf from "csurf";
import e_session from "express-session";
import cookieParser from "cookie-parser";
import { passport_auth, passport } from "./passport-strategy.js";
import flash from "express-flash";
import "dotenv/config";
import { CountryBlacklist } from "./filters/countryblacklist.js";
import { RateLimiter } from "./filters/rateLimiter.js";

const port = process.env.NERU_APP_PORT || 3001;
const app = express();

var session = neru.getSessionById(process.env.API_APPLICATION_ID);
const globalstate = new State(session);
const countryblacklist = new CountryBlacklist(globalstate);
const rateLimiter = new RateLimiter(globalstate);

const neru_sessions = function (req, res, next) {
  var sid = req.session.id;
  var session = neru.getSessionById(sid);
  console.log("neru_sess", session);
  next();
};

var api_key = "";
const ensureLoggedIn = function (req, res, next) {
  var session = neru.getSessionById(req.session.id);
  const state = new State(session);
  const neru_user = state.get("neru_user");
  var api_key = neru_user["api_key"];
  console.log(api_key);
  next();

  if (!neru_user) {
    next();
  } else {
    next();
  }
};

passport_auth(neru);

const __dirname = dirname(fileURLToPath(import.meta.url));
var path = __dirname + "/views/";
const {
  createProxyMiddleware,
  fixRequestBody,
  Filter,
  Options,
  RequestHandler,
} = hpm;

//You actually don't need neru router, just use your own
//const router = neru.Router()

// use bodyParser if not using neru
// You can leave this here even if using neru. neru will declare this when loading it's own Express
import bodyParser from "body-parser";
app.use(bodyParser.urlencoded());

/*>>>> IF Standalone: use standalone redis *****/

// import { createClient } from 'redis';
// const instanceState = createClient();

// instanceState.on('error', (err) => console.log('Redis Client Error', err));

// await instanceState.connect();

/*<<<< ENDIF Standalone *****/

app.use(cookieParser());
app.use(
  e_session({
    secret: "keyboard cat",
    resave: false, // don't save session if unmodified
    saveUninitialized: true, // don't create session until something stored
  })
);
app.use(neru_sessions);
app.use(flash());
app.use(passport.authenticate("session"));
app.use(function (req, res, next) {
  try {
    res.locals.csrfToken = req.csrfToken();
  } catch (e) {
    //nothing
  }
  next();
});

//load the css, js, fonts to static paths so it's easier to call in template
app.use(
  "/fonts",
  express.static(join(__dirname, "node_modules/bootstrap/fonts"))
);
app.use(
  "/css",
  express.static(join(__dirname, "node_modules/bootstrap/dist/css"))
);
app.use(
  "/css",
  express.static(join(__dirname, "node_modules/bootstrap-select/dist/css"))
);
app.use(
  "/css",
  express.static(
    join(__dirname, "node_modules/bootstrap-select-country/dist/css")
  )
);
app.use(
  "/js",
  express.static(join(__dirname, "node_modules/bootstrap/dist/js"))
);
app.use(
  "/js",
  express.static(join(__dirname, "node_modules/bootstrap-select/dist/js"))
);
app.use(
  "/js",
  express.static(
    join(__dirname, "node_modules/bootstrap-select-country/dist/js")
  )
);
app.use("/js", express.static(join(__dirname, "node_modules/jquery/dist")));

app.use(
  "/sms",
  //custom middleware to check if "to" is blacklisted
  // [countryblacklist.blacklist_to, rateLimiter.customLimiter],\
  [countryblacklist.blacklist_to, rateLimiter.customLimiter],
  //http proxy middleware
  createProxyMiddleware({
    target: "https://rest.nexmo.com",
    changeOrigin: true,
    onProxyReq: (proxyReq, req, res) => {
      fixRequestBody(proxyReq, req); //this fixes the body to orignal format before modifed by body-parer
      //this happens because neru loads body parser and changes the body to json instead of the default form paramas that rest.nexmo needs
    },
  })
);

//see if service is live
app.get("/", async (req, res, next) => {
  res.send("Vonage Proxy Service");
});

//Set Blacklist
app.post("/set_blacklist", csrf(), async (req, res, next) => {
  var blacklist = req.body.data;
  if (!blacklist) blacklist = [];
  await globalstate.set("blacklist", JSON.stringify(blacklist));
  blacklist = blacklist.map(
    (i) => i + ": " + isoCountry.getName(i, "en", { select: "official" })
  );
  res.status(200).send(blacklist);
});

//Get Blacklist
app.get("/blacklist", async (req, res, next) => {
  var blacklist = await globalstate.get("blacklist");
  res.send(JSON.parse(""));
});

//Set Blacklist
app.post("/set_ratelimit", csrf(), async (req, res, next) => {
  var data = req.body.data;
  // { rateLimiterNumber: '0', rateLimiterUnit: 'minutes' }
  if (!data) {
    data = { rateLimiterNumber: 25 * 60, rateLimiterUnit: "minutes" }; // default value
  }
  await globalstate.set("rateLimiterOptions", JSON.stringify(data));
  rateLimiter.setRateLimiter();
  res.status(200).send(data);
});

//Load Conf page
app.get("/conf", csrf(), async (req, res, next) => {
  //use consolidate js to load ejs file since we don't have access to express
  var blacklist = await globalstate.get("blacklist");
  if (!blacklist) blacklist = "[]";
  blacklist = JSON.parse(blacklist);
  var blacklist_selected = blacklist.join(",");
  var blacklist_with_name = blacklist.map(
    (i) => i + ": " + isoCountry.getName(i, "en", { select: "official" })
  );
  cons.ejs(
    path + "conf.ejs",
    {
      blacklist_selected: blacklist_selected,
      blacklist_with_name: blacklist_with_name,
      user: req.user,
      csrfToken: req.csrfToken(),
    },
    function (err, html) {
      if (err) throw err;
      res.send(html);
    }
  );
  //console.log("SIDXX: ",req.session.id)
  // res.send(req.session.id);
});
//y6Cf7b9AycyYc6iq_6jCYAavQOTPotLj

app.get("/login", csrf(), function (req, res, next) {
  cons.ejs(
    path + "login.ejs",
    { csrfToken: req.csrfToken(), messages: req.flash("error") },
    async function (err, html) {
      if (err) throw err;
      console.log("SID: ", req.session.id);
      res.send(html);
    }
  );
});

app.post(
  "/login",
  csrf(),
  passport.authenticate("local", {
    successRedirect: "conf",
    failureRedirect: "login",
    failureFlash: true,
  })
);

app.post("/logout", function (req, res, next) {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("login");
  });
});

app.get("/logout", function (req, res, next) {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("login");
  });
});

console.log(process.env);
app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
