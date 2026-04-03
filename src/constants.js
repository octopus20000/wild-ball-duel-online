const FIELD = {
  width: 1280,
  height: 720,
  halfWidth: 640
};

const CONFIG = {
  fps: 90,
  broadcastHz: 40,
  lagCompHitRewindMs: 80,
  lagCompHitExtraRadius: 14,
  lagCompSpecialExtraRadius: 8,
  ballHistoryMs: 250,
  roundDelayMs: 1200,
  winningScore: 7,
  playerSize: 84,
  playerRadius: 42,
  ballRadius: 18,
  moveSpeed: 405,
  dashSpeed: 760,
  dashDurationMs: 190,
  dashCooldownMs: 1150,
  hitWindowMs: 160,
  hitCooldownMs: 320,
  specialDurationMs: 1400,
  specialCooldownMs: 4500,
  hitSpeed: 500,
  softBounce: 255,
  empoweredMultiplierX: 1.55,
  empoweredMultiplierY: 1.16,
  empoweredMinSpeed: 920,
  empoweredFireMs: 1200,
  friction: 0.9992,
  wallBounce: 0.995,
  maxBallSpeed: 1180,
  touchPaddingIdle: 12,
  touchPaddingHit: 30,
  touchPaddingSpecial: 14,
  topBoostZoneY: 150,
  topBoostPadding: 16,
  minXPadding: 14,
  minYPadding: 72,
  maxBottomPadding: 18
};

module.exports = { FIELD, CONFIG };
