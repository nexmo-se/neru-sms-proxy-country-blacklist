import parsePhoneNumber from 'libphonenumber-js';

export function CountryBlacklist(state) {
  this.test = '123';
  this.blacklist_to = function (req, res, next) {
    state.get('blacklist').then((blacklist) => {
      if (!blacklist) {
        next();
      } else {
        const phoneNumber = parsePhoneNumber('+' + req.body.to);
        blacklist = JSON.parse(blacklist);
        if (blacklist.includes(phoneNumber.country)) {
          res.status(403).send('Country in Blocked List');
        } else {
          next();
        }
      }
    });
  };

  this.blacklist_from = function (req, res, next) {
    state.get('blacklist').then((blacklist) => {
      if (!blacklist) {
        next();
      } else {
        const phoneNumber = parsePhoneNumber('+' + req.body.from);
        blacklist = JSON.parse(blacklist);
        if (blacklist.includes(phoneNumber.country)) {
          res.status(403).send('Country in Blocked List');
        } else {
          next();
        }
      }
    });
  };

  this.number_to = function (req, res, next) {
    state.get('backlist').then((blacklist) => {
      if (!blacklist) {
        next();
      } else {
        if (req.body.to) {
          console.log('to');
          const phoneNumber = parsePhoneNumber('+' + req.body.to);
          blacklist = JSON.parse(blacklist);
          // if to exists in blacklist, return false
          if (blacklist.includes(phoneNumber.to)) {
            res.status(403).send('To Number is blocked!');
            // if to does not exist in blacklist, return true
          } else {
            res.status(200).send('To Number is not blocked!');
          }
        } else {
          next();
        }
      }
    });
  };
}
