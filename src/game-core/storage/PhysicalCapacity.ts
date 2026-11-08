/** A detached, deterministic calculation primitive. It is not connected to SaveFile or actions. */
export type PhysicalKind = 'MaterialLot' | 'DishLot';
export type PhysicalUnit = 'g' | 'ml' | 'count' | 'serving';

export interface PhysicalRate {
  /** milligrams or microlitres per quantity unit, as an exact positive rational */
  numerator: number;
  denominator: number;
}

export interface PhysicalRule {
  kind: PhysicalKind;
  definition_id: string;
  form: string;
  quantity_unit: PhysicalUnit;
  mass_mg_per_unit: PhysicalRate;
  volume_ul_per_unit: PhysicalRate;
}

export interface PhysicalPolicy {
  /** Persist this identity with the save and resolve it through an immutable, versioned registry.
   * Never replace historical rules under the same id; keep them available for future reads.
   * This detached module checks identity only: registry persistence is the caller's responsibility. */
  id: string;
  rules: readonly PhysicalRule[];
}

export interface PhysicalContainer {
  id: string;
  location_id: string;
  storage_type: string;
  supported_forms: readonly string[];
  limits: { mass_g: number; volume_ml: number };
}

export interface PhysicalOccupant {
  kind: PhysicalKind;
  id: string;
  definition_id: string;
  form: string;
  quantity: { amount: number; unit: PhysicalUnit };
  storage_ref: { container_id: string; location_id: string; storage_type: string };
  /** Optional measured/estimated whole-item measurements, supplied by the caller, never inferred. */
  pieces?: readonly { mass_g: number; volume_ml: number }[];
}

export interface PhysicalResult {
  policy_id: string;
  containers: ReadonlyMap<string, {
    mass_g: number;
    volume_ml: number;
    refs: readonly { kind: PhysicalKind; id: string }[];
    overflow: readonly ('mass' | 'volume')[];
  }>;
}

type Fraction = { n: bigint; d: bigint };

function fail(code: string): never { throw new Error(code); }
function identifier(value: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) return fail('ERR_PHYSICAL_ID_INVALID');
  return value;
}
function powerOfTen(exponent: number): bigint {
  // Avoid BigInt **: an ES2015 transform can lower ** to Math.pow, which rejects BigInt.
  let result = 1n;
  for (let i = 0; i < exponent; i++) result *= 10n;
  return result;
}

// Number.toString gives a deterministic decimal representation including exponent notation.
function fraction(value: number, positive: boolean): Fraction {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value === 0)
      || value > Number.MAX_SAFE_INTEGER) return fail('ERR_PHYSICAL_NUMBER_INVALID');
  const text = value.toString().toLowerCase();
  const [mantissa, exponentText] = text.split('e');
  const [whole, decimals = ''] = mantissa!.split('.');
  const exponent = Number(exponentText ?? '0') - decimals.length;
  const digits = BigInt(`${whole}${decimals}`);
  return exponent >= 0 ? { n: digits * powerOfTen(exponent), d: 1n }
    : { n: digits, d: powerOfTen(-exponent) };
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) { const next = a % b; a = b; b = next; }
  return a;
}
function reduce(n: bigint, d: bigint): Fraction { const divisor = gcd(n, d); return { n: n / divisor, d: d / divisor }; }
function add(a: Fraction, b: Fraction): Fraction { return reduce(a.n * b.d + b.n * a.d, a.d * b.d); }
function multiply(a: Fraction, b: Fraction): Fraction { return reduce(a.n * b.n, a.d * b.d); }
function equal(a: Fraction, b: Fraction): boolean { return a.n * b.d === b.n * a.d; }
function scale(a: Fraction, factor: bigint): Fraction { return { n: a.n * factor, d: a.d }; }
function ceil(a: Fraction): bigint { return (a.n + a.d - 1n) / a.d; }
function integral(a: Fraction): bigint {
  if (a.n % a.d !== 0n) return fail('ERR_PHYSICAL_LIMIT_PRECISION');
  return a.n / a.d;
}
function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return fail('ERR_PHYSICAL_NUMBER_RANGE');
  return Number(value);
}
function rate(value: PhysicalRate): Fraction {
  if (!value || !Number.isSafeInteger(value.numerator) || value.numerator <= 0
      || !Number.isSafeInteger(value.denominator) || value.denominator <= 0) return fail('ERR_PHYSICAL_RATE_INVALID');
  return { n: BigInt(value.numerator), d: BigInt(value.denominator) };
}

/** The caller must supply the immutable policy matching the save's persisted policy identity. */
export function calculatePhysicalCapacity(input: {
  policy_id: string;
  policy: PhysicalPolicy;
  containers: readonly PhysicalContainer[];
  occupants: readonly PhysicalOccupant[];
}): PhysicalResult {
  const policyId = identifier(input.policy_id);
  if (!input.policy || identifier(input.policy.id) !== policyId) return fail('ERR_PHYSICAL_POLICY_MISMATCH');
  const rules = new Map<string, { mass: Fraction; volume: Fraction }>();
  const key = (kind: string, id: string, form: string, unit: string) => JSON.stringify([kind, id, form, unit]);
  for (const rule of input.policy.rules) {
    if (!['MaterialLot', 'DishLot'].includes(rule.kind) || !['g', 'ml', 'count', 'serving'].includes(rule.quantity_unit))
      return fail('ERR_PHYSICAL_RULE_INVALID');
    const ruleKey = key(rule.kind, identifier(rule.definition_id), identifier(rule.form), rule.quantity_unit);
    if (rules.has(ruleKey)) return fail('ERR_PHYSICAL_RULE_DUPLICATE');
    rules.set(ruleKey, { mass: rate(rule.mass_mg_per_unit), volume: rate(rule.volume_ul_per_unit) });
  }

  const accumulators = new Map<string, { container: PhysicalContainer; mass: Fraction; volume: Fraction;
    massLimit: bigint; volumeLimit: bigint; refs: { kind: PhysicalKind; id: string }[] }>();
  for (const container of input.containers) {
    const id = identifier(container.id);
    if (accumulators.has(id)) return fail('ERR_PHYSICAL_CONTAINER_DUPLICATE');
    identifier(container.location_id); identifier(container.storage_type);
    if (!container.supported_forms.length) return fail('ERR_PHYSICAL_FORM_INVALID');
    for (const form of container.supported_forms) identifier(form);
    const massLimit = integral(scale(fraction(container.limits.mass_g, true), 1000n));
    const volumeLimit = integral(scale(fraction(container.limits.volume_ml, true), 1000n));
    safeNumber(massLimit); safeNumber(volumeLimit);
    accumulators.set(id, { container, mass: { n: 0n, d: 1n }, volume: { n: 0n, d: 1n }, massLimit, volumeLimit, refs: [] });
  }
  const seen = new Set<string>();
  for (const occupant of input.occupants) {
    if (!['MaterialLot', 'DishLot'].includes(occupant.kind)) return fail('ERR_PHYSICAL_OBJECT_INVALID');
    const objectId = identifier(occupant.id);
    const objectKey = JSON.stringify([occupant.kind, objectId]);
    if (seen.has(objectKey)) return fail('ERR_PHYSICAL_OBJECT_DUPLICATE');
    seen.add(objectKey);
    const target = accumulators.get(identifier(occupant.storage_ref.container_id));
    if (!target || target.container.location_id !== occupant.storage_ref.location_id
        || target.container.storage_type !== occupant.storage_ref.storage_type) return fail('ERR_PHYSICAL_STORAGE_REF_INVALID');
    const form = identifier(occupant.form);
    if (!target.container.supported_forms.includes(form)) return fail('ERR_PHYSICAL_FORM_NOT_SUPPORTED');
    const unit = occupant.quantity.unit;
    if (!['g', 'ml', 'count', 'serving'].includes(unit)) return fail('ERR_PHYSICAL_UNIT_INVALID');
    const amount = fraction(occupant.quantity.amount, true);
    if ((unit === 'count' || unit === 'serving') && !Number.isSafeInteger(occupant.quantity.amount))
      return fail('ERR_PHYSICAL_DISCRETE_QUANTITY_INVALID');
    const matched = rules.get(key(occupant.kind, identifier(occupant.definition_id), form, unit));
    if (!matched) return fail('ERR_PHYSICAL_RULE_NOT_FOUND');
    let mass = multiply(amount, matched.mass);
    let volume = multiply(amount, matched.volume);
    if (occupant.pieces !== undefined) {
      if (occupant.kind !== 'MaterialLot' || unit !== 'g' || occupant.pieces.length === 0)
        return fail('ERR_PHYSICAL_PIECES_INVALID');
      let pieceMass: Fraction = { n: 0n, d: 1n };
      let pieceVolume: Fraction = { n: 0n, d: 1n };
      for (const piece of occupant.pieces) {
        pieceMass = add(pieceMass, fraction(piece.mass_g, true));
        pieceVolume = add(pieceVolume, fraction(piece.volume_ml, true));
      }
      if (!equal(pieceMass, amount) || !equal(mass, scale(pieceMass, 1000n)))
        return fail('ERR_PHYSICAL_PIECES_MASS_MISMATCH');
      mass = scale(pieceMass, 1000n);
      volume = scale(pieceVolume, 1000n);
    }
    target.mass = add(target.mass, mass);
    target.volume = add(target.volume, volume);
    target.refs.push({ kind: occupant.kind, id: objectId });
  }
  const result = new Map<string, { mass_g: number; volume_ml: number; refs: readonly { kind: PhysicalKind; id: string }[]; overflow: ('mass' | 'volume')[] }>();
  for (const [id, target] of accumulators) {
    const mass = ceil(target.mass), volume = ceil(target.volume);
    const overflow: ('mass' | 'volume')[] = [];
    if (mass > target.massLimit) overflow.push('mass');
    if (volume > target.volumeLimit) overflow.push('volume');
    result.set(id, { mass_g: safeNumber(mass) / 1000, volume_ml: safeNumber(volume) / 1000, refs: target.refs, overflow });
  }
  return { policy_id: policyId, containers: result };
}
