// Lichess-style cburnett chess piece SVGs (public domain).
// White pieces: white fill, soft gray outlines.
// Black pieces: dark charcoal #363636 fill, subtle gray detail lines.
// viewBox is 0 0 45 45 for all pieces.

const strokeW = 'stroke:#a7a7a7;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;fill:none';
const strokeB = 'stroke:#000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;fill:none';

const SVG = {
  // White King
  K: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g style="${strokeW}"><path d="M22.5 11.63V6M20 8h5" stroke-linejoin="miter"/><path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill:#fff stroke-linecap:butt stroke-linejoin:miter/><path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-13.5-3.5 0 0-1 2.5-3 2.5s-3-2.5-3-2.5c0 0-9.5-3-13.5 3.5-3 6 6 10.5 6 10.5v7z" fill:#fff/><path d="M11.5 30c5.5-3 15.5-3 21 0M11.5 33.5c5.5-3 15.5-3 21 0M11.5 37c5.5-3 15.5-3 21 0" stroke-linecap:butt/></g></svg>`,

  // White Queen
  Q: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g style="${strokeW}"><path d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5L15 11v14L8 14l1 12z" fill:#fff stroke-linecap:butt/><path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5 1.5 1.5 2.5 1.5 2.5 1.5 1.5 0 2.5 0 5-1 1.5-1 3-1.5 3-1.5 0 0-.5-1.5-1.5-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" fill:#fff/><path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c4-1 17.5-1 21.5 0" fill:none/><circle cx="6" cy="12" r="2" fill:#fff/><circle cx="14" cy="9" r="2" fill:#fff/><circle cx="22.5" cy="8" r="2" fill:#fff/><circle cx="31" cy="9" r="2" fill:#fff/><circle cx="39" cy="12" r="2" fill:#fff/></g></svg>`,

  // White Rook
  R: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g style="${strokeW}" fill=#fff><path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5" stroke-linecap:butt/><path d="M34 14l-3 3H14l-3-3"/><path d="M31 17v12.5H14V17" stroke-linecap:butt stroke-linejoin:miter/><path d="M31 29.5l1.5 2.5h-20l1.5-2.5"/><path d="M11 14h23" fill:none stroke-linejoin:miter/></g></svg>`,

  // White Bishop
  B: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g style="${strokeW}" fill=#fff><path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.41-2.323.47-3-.5 1.354-1.94 3-2 3-2zM15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-7.5-4s-7.5 1.5-7.5 4c0 0-.5.5 0 2z" fill=#fff/><path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z" fill=#fff/><path d="M17.5 26h10M15 30h15M22.5 15.5v10M20 18h5" stroke-linejoin:miter/></g></svg>`,

  // White Knight
  N: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g style="${strokeW}" fill=#fff><path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill=#fff/><path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3.91-1.282-.74-1.64.89-2.3.67-.91-.32.96-2.16 0-2.76-1.52-.91-2.5 2.03-2.5 2.03C5 26 5 18 12 14c5-2.5 5-3.5 5-6 2.5 2 6 4 7 4 1.5 0 2.5-2 2.5-2.5 0-1 .5-1 .5-1z" fill=#fff/><path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0z" fill=#666 stroke=#666/><path d="M15 15.5a.5 1.5 0 1 1-1 0 .5 1.5 0 1 1 1 0z" fill=#666 stroke=#666 transform="matrix(.866 .5 -.5 .866 9.693 -5.183)"/></g></svg>`,

  // White Pawn
  P: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03C15.41 27.09 11 31.58 11 39.5H34c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill=#fff stroke=#a7a7a7 stroke-width=1.5 stroke-linecap=round/></svg>`,

  // Black King
  k: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g style="${strokeB}"><path d="M22.5 11.63V6M20 8h5" stroke-linejoin="miter"/><path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill=#363636 stroke-linecap:butt stroke-linejoin:miter/><path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-13.5-3.5 0 0-1 2.5-3 2.5s-3-2.5-3-2.5c0 0-9.5-3-13.5 3.5-3 6 6 10.5 6 10.5v7z" fill=#363636/><path d="M11.5 30c5.5-3 15.5-3 21 0M11.5 33.5c5.5-3 15.5-3 21 0M11.5 37c5.5-3 15.5-3 21 0" stroke=#888 stroke-linecap:butt/></g></svg>`,

  // Black Queen
  q: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g style="${strokeB}"><path d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5L15 11v14L8 14l1 12z" fill=#363636 stroke-linecap:butt/><path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5 1.5 1.5 2.5 1.5 2.5 1.5 1.5 0 2.5 0 5-1 1.5-1 3-1.5 3-1.5 0 0-.5-1.5-1.5-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" fill=#363636/><path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c4-1 17.5-1 21.5 0" fill:none stroke=#888/><circle cx="6" cy="12" r="2" fill=#363636/><circle cx="14" cy="9" r="2" fill=#363636/><circle cx="22.5" cy="8" r="2" fill=#363636/><circle cx="31" cy="9" r="2" fill=#363636/><circle cx="39" cy="12" r="2" fill=#363636/></g></svg>`,

  // Black Rook
  r: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g style="${strokeB}" fill=#363636><path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5" stroke-linecap:butt/><path d="M34 14l-3 3H14l-3-3"/><path d="M31 17v12.5H14V17" stroke-linecap:butt stroke-linejoin:miter/><path d="M31 29.5l1.5 2.5h-20l1.5-2.5"/><path d="M11 14h23" fill:none stroke-linejoin:miter/></g></svg>`,

  // Black Bishop
  b: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g style="${strokeB}" fill=#363636><path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.41-2.323.47-3-.5 1.354-1.94 3-2 3-2zM15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-7.5-4s-7.5 1.5-7.5 4c0 0-.5.5 0 2z" fill=#363636/><path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z" fill=#363636/><path d="M17.5 26h10M15 30h15M22.5 15.5v10M20 18h5" stroke=#888 stroke-linejoin:miter/></g></svg>`,

  // Black Knight
  n: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g style="${strokeB}" fill=#363636><path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill=#363636/><path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3.91-1.282-.74-1.64.89-2.3.67-.91-.32.96-2.16 0-2.76-1.52-.91-2.5 2.03-2.5 2.03C5 26 5 18 12 14c5-2.5 5-3.5 5-6 2.5 2 6 4 7 4 1.5 0 2.5-2 2.5-2.5 0-1 .5-1 .5-1z" fill=#363636/><path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0z" fill=#ddd stroke=#ddd/><path d="M15 15.5a.5 1.5 0 1 1-1 0 .5 1.5 0 1 1 1 0z" fill=#ddd stroke=#ddd transform="matrix(.866 .5 -.5 .866 9.693 -5.183)"/></g></svg>`,

  // Black Pawn
  p: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03C15.41 27.09 11 31.58 11 39.5H34c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill=#363636 stroke=#000 stroke-width=1.5 stroke-linecap=round/></svg>`,
};

export function pieceSVG(char) {
  return SVG[char] || '';
}
