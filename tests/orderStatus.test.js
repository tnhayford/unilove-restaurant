const { ORDER_STATUS, canTransition } = require("../src/utils/orderStatus");

describe("order status transition policy", () => {
  it("allows pending payment to paid", () => {
    expect(canTransition(ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAID)).toBe(true);
  });

  it("blocks delivered back to paid", () => {
    expect(canTransition(ORDER_STATUS.DELIVERED, ORDER_STATUS.PAID)).toBe(false);
  });

  it("allows out-for-delivery to delivered", () => {
    expect(canTransition(ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED)).toBe(true);
  });

  it("allows ready-for-pickup to out-for-delivery for dispatch workflow", () => {
    expect(canTransition(ORDER_STATUS.READY_FOR_PICKUP, ORDER_STATUS.OUT_FOR_DELIVERY)).toBe(true);
  });

  it("allows payment failed back to pending payment for prompt retry", () => {
    expect(canTransition(ORDER_STATUS.PAYMENT_FAILED, ORDER_STATUS.PENDING_PAYMENT)).toBe(true);
  });
});
