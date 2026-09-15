import jsQR from 'jsqr';

/**
 * Decodes a QR code from an image already loaded into a canvas ImageData.
 * Kept as a thin, pure wrapper around jsQR so the pairing screen only ever
 * hands it pixels — no camera/DOM dependency here, which keeps this part
 * trivially testable even though the mandate's required coverage
 * (pairing parser, token storage, event mapper) lives elsewhere.
 */
export function decodeQrFromImageData(data: Uint8ClampedArray, width: number, height: number): string | null {
  const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  return result ? result.data : null;
}
