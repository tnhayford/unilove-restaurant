function calculateLoyaltyPoints(orderTotal) {
  return Math.floor(Number(orderTotal) / 35) * 5;
}

module.exports = { calculateLoyaltyPoints };
