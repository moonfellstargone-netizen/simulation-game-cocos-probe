import type { Quantity } from '../domain/types';

export class QuantityService {
  assertSameUnit(left: Quantity, right: Quantity): void {
    if (left.unit !== right.unit) {
      throw new Error(`ERR_QUANTITY_UNIT_MISMATCH:${left.unit}:${right.unit}`);
    }
  }

  hasAtLeast(current: Quantity, required: Quantity): boolean {
    this.assertSameUnit(current, required);
    return current.amount >= required.amount;
  }

  add(left: Quantity, right: Quantity): Quantity {
    this.assertSameUnit(left, right);
    return { amount: left.amount + right.amount, unit: left.unit };
  }

  subtract(left: Quantity, right: Quantity): Quantity {
    this.assertSameUnit(left, right);
    const amount = left.amount - right.amount;
    if (amount < -Number.EPSILON) {
      throw new Error('ERR_NOT_ENOUGH_RESOURCE');
    }
    return { amount: Math.max(0, amount), unit: left.unit };
  }
}
