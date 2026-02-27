const { z } = require("zod");
const { searchCustomersByPhonePrefix } = require("../repositories/customerRepository");

const querySchema = z.object({
  phone: z.string().trim().min(3).max(20),
  limit: z.string().regex(/^\d+$/).optional(),
});

async function searchCustomers(req, res) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const { phone, limit } = parsed.data;
  const rows = await searchCustomersByPhonePrefix(phone, limit ? Number(limit) : 8);
  return res.json({
    data: rows.map((row) => ({
      id: row.id,
      phone: row.phone,
      fullName: row.full_name,
      lastOrderAt: row.last_order_at,
    })),
  });
}

module.exports = { searchCustomers };
