import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import { PairingPayloadError, isPairingExpired, parsePairingPayload, type PairingPayload } from '../lib/pairing.js'
import { decodeQrFromImageData } from '../lib/qrDecode.js'

export interface PairingScreenElements {
  root: HTMLElement
  textarea: HTMLTextAreaElement
  scanButton: HTMLButtonElement
  pairButton: HTMLButtonElement
  status: HTMLElement
  canvas: HTMLCanvasElement
}

export function queryPairingElements(root: HTMLElement): PairingScreenElements {
  const textarea = root.querySelector<HTMLTextAreaElement>('#pairing-json')
  const scanButton = root.querySelector<HTMLButtonElement>('[data-action="scan-qr"]')
  const pairButton = root.querySelector<HTMLButtonElement>('[data-action="pair-pasted"]')
  const status = root.querySelector<HTMLElement>('[data-pairing-status]')
  const canvas = root.querySelector<HTMLCanvasElement>('[data-scan-canvas]')
  if (!textarea || !scanButton || !pairButton || !status || !canvas) {
    throw new Error('pairing screen is missing required elements')
  }
  return { root, textarea, scanButton, pairButton, status, canvas }
}

function setStatus(el: HTMLElement, message: string, tone: 'info' | 'error' = 'info'): void {
  el.textContent = message
  if (tone === 'error') el.setAttribute('data-tone', 'error')
  else el.removeAttribute('data-tone')
}

/** Decodes a captured photo into a validated pairing payload, or throws with a message fit to show the user. */
async function decodePhotoToPayload(dataUrl: string, canvas: HTMLCanvasElement): Promise<PairingPayload> {
  const image = await loadImage(dataUrl)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas is unavailable on this device')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const text = decodeQrFromImageData(imageData.data, imageData.width, imageData.height)
  if (!text) throw new PairingPayloadError('no QR code found in that photo — try again, or paste the JSON')
  return parseAndCheckExpiry(text)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => { resolve(img) }
    img.onerror = () => { reject(new Error('could not read the captured photo')) }
    img.src = src
  })
}

export function parseAndCheckExpiry(raw: string): PairingPayload {
  const payload = parsePairingPayload(raw)
  if (isPairingExpired(payload)) {
    throw new PairingPayloadError('this pairing code has expired — generate a new QR on the host')
  }
  return payload
}

export interface PairingScreenOptions {
  onPayload: (payload: PairingPayload) => Promise<void>
}

export function wirePairingScreen(elements: PairingScreenElements, options: PairingScreenOptions): void {
  const { textarea, scanButton, pairButton, status, canvas } = elements

  pairButton.addEventListener('click', () => {
    void (async () => {
      try {
        const payload = parseAndCheckExpiry(textarea.value.trim())
        setStatus(status, `Pairing with ${payload.name}…`)
        await options.onPayload(payload)
      } catch (err) {
        setStatus(status, describeError(err), 'error')
      }
    })()
  })

  scanButton.addEventListener('click', () => {
    void (async () => {
      try {
        if (!Capacitor.isNativePlatform()) {
          setStatus(status, 'Camera scan needs the native app — paste the JSON in a browser preview.', 'error')
          return
        }
        setStatus(status, 'Opening camera…')
        const photo = await Camera.getPhoto({
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera,
          quality: 80,
        })
        if (!photo.dataUrl) throw new Error('camera returned no image')
        setStatus(status, 'Reading QR code…')
        const payload = await decodePhotoToPayload(photo.dataUrl, canvas)
        setStatus(status, `Pairing with ${payload.name}…`)
        await options.onPayload(payload)
      } catch (err) {
        setStatus(status, describeError(err), 'error')
      }
    })()
  })
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'something went wrong — try again'
}
