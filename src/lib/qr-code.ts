import QRCode from 'qrcode'

export async function generateQrSvg(text: string): Promise<string> {
  if (!text || !text.trim()) {
    throw new Error('QR code content cannot be empty')
  }
  return await QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  })
}
