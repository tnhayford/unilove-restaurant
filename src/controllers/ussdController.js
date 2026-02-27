const { handleUssdRequest } = require("../services/ussdService");

async function processUssd(req, res) {
  const body = await handleUssdRequest(req.validatedBody);
  return res.json(body);
}

module.exports = { processUssd };
