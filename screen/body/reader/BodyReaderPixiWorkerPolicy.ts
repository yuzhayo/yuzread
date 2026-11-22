// LOGIC — exact elapsed-time response/friction, independent of Pixi and DOM.
const FRICTION = 0.25,
  RESPONSE = 0.012,
  GAIN = 1.5,
  MAX_SPEED = 9000,
  STOP_SPEED = 5;
export const clampMomentum = (value: number) =>
  Number.isFinite(value) ? Math.max(-MAX_SPEED, Math.min(MAX_SPEED, value)) : 0;
export const momentumImpulse = (distance: number) => clampMomentum((distance * GAIN) / FRICTION);
export function advanceMomentum(velocity: number, target: number, elapsed: number) {
  velocity = clampMomentum(velocity);
  target = clampMomentum(target);
  const seconds = Number.isFinite(elapsed) ? Math.max(0, Math.min(0.05, elapsed)) : 0;
  const friction = Math.exp(-seconds / FRICTION),
    response = Math.exp(-seconds / RESPONSE);
  const weight = FRICTION / (FRICTION - RESPONSE);
  const distance =
    velocity * RESPONSE * (1 - response) +
    target * weight * (FRICTION * (1 - friction) - RESPONSE * (1 - response));
  const nextVelocity = clampMomentum(velocity * response + target * weight * (friction - response));
  const nextTarget = clampMomentum(target * friction);
  const moving = Math.abs(nextVelocity) >= STOP_SPEED || Math.abs(nextTarget) >= STOP_SPEED;
  return { distance, velocity: moving ? nextVelocity : 0, target: moving ? nextTarget : 0, moving };
}
