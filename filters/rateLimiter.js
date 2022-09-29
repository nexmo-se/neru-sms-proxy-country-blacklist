// Minimum window duration is 60s.

import moment from "moment";

export function RateLimiter(state) {
  this.windowDuration = 1;
  this.maxWindowRequestsCount = 25 * 60;
  this.windowLogDuration = 1;
  this.windowUnit = "minutes";
  this.setRateLimiter = async () => {
    const rateLimiterOptions = await state.get("rateLimiterOptions");
    if (!rateLimiterOptions) {
      return;
    }
    const rateLimiter = JSON.parse(rateLimiterOptions);
    console.log("[setRateLimiter] - rateLimiter", rateLimiter);
    if (rateLimiter) {
      this.maxWindowRequestsCount = Number(rateLimiter.rateLimiterNumber);
      this.windowUnit = rateLimiter.rateLimiterUnit;
    }
    console.log("[setRateLimiter] - rateLimiter2", this.maxWindowRequestsCount);
    console.log("[setRateLimiter] - windowUnit", this.windowUnit);
  };
  this.customLimiter = async (req, res, next) => {
    try {
      //Checks if Neru state is ready
      if (!state) {
        console.log("Neru state does not exist!");
        process.exit(1);
      }

      //Gets the records of the current from number, returns a null if the is no from number found
      const apikey = process.env.API_ACCOUNT_ID;
      const rateLimiterAccountId = await state.get(apikey);
      console.log("rateLimiterAccountId", rateLimiterAccountId);
      //   redis_client.get(req.ip, function (error, fromNumber) {
      const currentTime = moment();
      //When there is no fromNumber then a new fromNumber is created and stored in Neru
      if (rateLimiterAccountId == null) {
        let newFrom = [];
        let requestLog = {
          requestTimeStamp: currentTime.unix(),
          requestCount: 1,
        };
        newFrom.push(requestLog);

        console.log("[customLimiter] - Create new Item;newFrom", newFrom);
        await state.set(apikey, JSON.stringify(newFrom));
        next();
      } else {
        //When the fromNumber is found then its value is parsed and the number of requests the user has made within the last window is calculated
        let data = JSON.parse(rateLimiterAccountId);
        console.log("data", data);
        console.log("windowUnit", this.windowUnit);
        let windowBeginTimestamp = moment()
          .subtract(this.windowDuration, this.windowUnit)
          .unix();
        console.log("windowBeginTimestamp", windowBeginTimestamp);
        let requestsinWindow = data.filter((entry) => {
          console.log(
            "requestsinWindow1",
            entry.requestTimeStamp > windowBeginTimestamp
          );
          return entry.requestTimeStamp > windowBeginTimestamp;
        });
        console.log("requestsinWindow2", requestsinWindow);
        let totalWindowRequestsCount = requestsinWindow.reduce(
          (accumulator, entry) => {
            return accumulator + entry.requestCount;
          },
          0
        );
        console.log("totalWindowRequestsCount", totalWindowRequestsCount);
        console.log("maxWindowRequestsCount", this.maxWindowRequestsCount);
        //if maximum number of requests is exceeded then an error is returned
        if (totalWindowRequestsCount >= this.maxWindowRequestsCount) {
          res
            .status(429)
            .send(
              `You have exceeded the ${this.maxWindowRequestsCount} requests in ${this.windowDuration} ${this.windowUnit} limit!`
            );
        } else {
          //When the number of requests made are less than the maximum the a new entry is logged
          let lastRequestLog = data[data.length - 1];
          let potentialCurrentWindowIntervalStartTimeStamp = currentTime
            .subtract(this.windowLogDuration, this.windowUnit)
            .unix();
          //When the interval has not passed from the last request, then the counter increments
          if (
            lastRequestLog.requestTimeStamp >
            potentialCurrentWindowIntervalStartTimeStamp
          ) {
            lastRequestLog.requestCount++;
            data[data.length - 1] = lastRequestLog;
          } else {
            //When the interval has passed, a new entry for current user and timestamp is logged
            data.push({
              requestTimeStamp: currentTime.unix(),
              requestCount: 1,
            });
          }
          await state.set(apikey, JSON.stringify(data));
          next();
        }
      }
    } catch (error) {
      console.log("rateLimiter Error", error);
      next(error);
    }
  };
}
