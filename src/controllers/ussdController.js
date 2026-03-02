const { handleUssdRequest } = require("../services/ussdService");
const { logHubtelEvent } = require("../services/hubtelLiveLogService");

async function processUssd(req, res) {
  logHubtelEvent("USSD_REQUEST_IN", {
    route: "/api/ussd/interaction",
    body: req.validatedBody,
  });

  const body = await handleUssdRequest(req.validatedBody);
  logHubtelEvent("USSD_RESPONSE_OUT", {
    route: "/api/ussd/interaction",
    body,
  });
  return res.json(body);
}

module.exports = { processUssd };
