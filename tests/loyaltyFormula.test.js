const { calculateLoyaltyPoints } = require("../src/utils/loyalty");

describe("calculateLoyaltyPoints", () => {
  it("returns 0 below 35 cedis", () => {
    expect(calculateLoyaltyPoints(34.99)).toBe(0);
  });

  it("awards 5 points for exactly 35 cedis", () => {
    expect(calculateLoyaltyPoints(35)).toBe(5);
  });

  it("awards floor(order_total/35)*5", () => {
    expect(calculateLoyaltyPoints(70)).toBe(10);
    expect(calculateLoyaltyPoints(139.99)).toBe(15);
    expect(calculateLoyaltyPoints(140)).toBe(20);
  });
});
