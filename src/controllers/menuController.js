const { getMenu } = require("../services/menuService");

async function listMenu(req, res) {
  const menu = await getMenu();
  return res.json({ data: menu });
}

module.exports = { listMenu };
