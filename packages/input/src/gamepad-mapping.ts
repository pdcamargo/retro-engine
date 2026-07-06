/**
 * A gamepad button in the W3C "Standard Gamepad" layout. Names are
 * position-based (Xbox-style): `South`/`East`/`West`/`North` are the face
 * buttons (A/B/X/Y on Xbox, ✕/○/□/△ on PlayStation). Populated only when a pad
 * reports `mapping === 'standard'`; otherwise read raw indices via
 * `GamepadState.buttonAt`.
 */
export type GamepadButton =
  | 'South'
  | 'East'
  | 'West'
  | 'North'
  | 'LeftShoulder'
  | 'RightShoulder'
  | 'LeftTrigger'
  | 'RightTrigger'
  | 'Select'
  | 'Start'
  | 'LeftStick'
  | 'RightStick'
  | 'DPadUp'
  | 'DPadDown'
  | 'DPadLeft'
  | 'DPadRight'
  | 'Home';

/**
 * A gamepad analog axis. Stick axes come from the standard axes array; the
 * triggers are surfaced as `[0, 1]` axes from their analog button values. Stick
 * Y is normalized so **up is `+1`** (the API reports up as negative).
 */
export type GamepadAxis =
  | 'LeftStickX'
  | 'LeftStickY'
  | 'RightStickX'
  | 'RightStickY'
  | 'LeftTrigger'
  | 'RightTrigger';

/**
 * Standard-mapping button names indexed by their position in a
 * `Gamepad.buttons` array (W3C Standard Gamepad). Index-aligned: entry `i` is
 * the name of `buttons[i]`.
 */
export const STANDARD_BUTTONS: readonly GamepadButton[] = [
  'South',
  'East',
  'West',
  'North',
  'LeftShoulder',
  'RightShoulder',
  'LeftTrigger',
  'RightTrigger',
  'Select',
  'Start',
  'LeftStick',
  'RightStick',
  'DPadUp',
  'DPadDown',
  'DPadLeft',
  'DPadRight',
  'Home',
];

/**
 * Standard-mapping stick-axis names indexed by their position in a
 * `Gamepad.axes` array: `[LeftStickX, LeftStickY, RightStickX, RightStickY]`.
 */
export const STANDARD_STICK_AXES: readonly GamepadAxis[] = [
  'LeftStickX',
  'LeftStickY',
  'RightStickX',
  'RightStickY',
];

/** `Gamepad.buttons` index of the analog left trigger. */
export const LEFT_TRIGGER_BUTTON = 6;
/** `Gamepad.buttons` index of the analog right trigger. */
export const RIGHT_TRIGGER_BUTTON = 7;
