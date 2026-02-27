const {
  getMenuForAdmin,
  updateMenuAvailability,
  getMenuCategoriesForAdmin,
  createMenuItemForAdmin,
  editMenuItemForAdmin,
  removeMenuItemForAdmin,
  createMenuCategoryForAdmin,
  renameMenuCategoryForAdmin,
  removeMenuCategoryForAdmin,
  optimizeMenuUssdNamesForAdmin,
} = require("../services/menuService");

async function listMenuForAdmin(req, res) {
  const data = await getMenuForAdmin();
  return res.json({ data });
}

async function setMenuAvailability(req, res) {
  const result = await updateMenuAvailability({
    itemId: req.params.itemId,
    isActive: req.validatedBody.isActive,
    adminId: req.admin.sub,
  });
  return res.json({ data: result });
}

async function listMenuCategories(req, res) {
  const data = await getMenuCategoriesForAdmin();
  return res.json({ data });
}

async function createMenuItem(req, res) {
  const data = await createMenuItemForAdmin({
    ...req.validatedBody,
    adminId: req.admin.sub,
  });
  return res.status(201).json({ data });
}

async function updateMenuItem(req, res) {
  const data = await editMenuItemForAdmin({
    itemId: req.params.itemId,
    ...req.validatedBody,
    adminId: req.admin.sub,
  });
  return res.json({ data });
}

async function removeMenuItem(req, res) {
  const data = await removeMenuItemForAdmin({
    itemId: req.params.itemId,
    adminId: req.admin.sub,
  });
  return res.json({ data });
}

async function createMenuCategory(req, res) {
  const data = await createMenuCategoryForAdmin({
    category: req.validatedBody.category,
    adminId: req.admin.sub,
  });
  return res.status(201).json({ data });
}

async function renameMenuCategory(req, res) {
  const data = await renameMenuCategoryForAdmin({
    fromCategory: req.validatedBody.fromCategory,
    toCategory: req.validatedBody.toCategory,
    adminId: req.admin.sub,
  });
  return res.json({ data });
}

async function removeMenuCategory(req, res) {
  const data = await removeMenuCategoryForAdmin({
    category: req.validatedBody.category,
    adminId: req.admin.sub,
  });
  return res.json({ data });
}

async function optimizeMenuUssdNames(req, res) {
  const data = await optimizeMenuUssdNamesForAdmin({
    adminId: req.admin.sub,
  });
  return res.json({ data });
}

module.exports = {
  listMenuForAdmin,
  setMenuAvailability,
  listMenuCategories,
  createMenuItem,
  updateMenuItem,
  removeMenuItem,
  createMenuCategory,
  renameMenuCategory,
  removeMenuCategory,
  optimizeMenuUssdNames,
};
