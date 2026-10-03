import AppKit
// usage: make-icon <out.png> <variant: light|dark|tinted>
let out = CommandLine.arguments[1], variant = CommandLine.arguments[2]
let S = 1024
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: S, height: S, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
func c(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: cs, components: [CGFloat(hex >> 16 & 0xFF) / 255, CGFloat(hex >> 8 & 0xFF) / 255,
                                         CGFloat(hex & 0xFF) / 255, a])!
}
func gradient(_ colors: [CGColor]) -> CGGradient {
    CGGradient(colorsSpace: cs, colors: colors as CFArray, locations: nil)!
}

struct Palette { let bg: [CGColor]; let glow: CGColor; let cloud: [CGColor]; let shadow: CGColor; let cursor: CGColor }
let p: Palette = switch variant {
case "dark":
    Palette(bg: [c(0x0B0D17), c(0x05060B)], glow: c(0x4F46E5, 0.28),
            cloud: [c(0xC7D2FE), c(0x818CF8)], shadow: c(0x000000, 0.6), cursor: c(0x22D3EE))
case "tinted":
    Palette(bg: [c(0x000000), c(0x000000)], glow: c(0xFFFFFF, 0),
            cloud: [c(0xFFFFFF), c(0xD4D4D4)], shadow: c(0x000000, 0), cursor: c(0x8A8A8A))
default:
    Palette(bg: [c(0x0F172A), c(0x3730A3)], glow: c(0x6366F1, 0.45),
            cloud: [c(0xFFFFFF), c(0xDCE3FF)], shadow: c(0x0B1026, 0.55), cursor: c(0x06B6D4))
}

func background() {
    ctx.drawLinearGradient(gradient(p.bg), start: CGPoint(x: 0, y: S), end: CGPoint(x: S, y: 0),
                           options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
}
background()
ctx.drawRadialGradient(gradient([p.glow, c(0x6366F1, 0)]), startCenter: CGPoint(x: 512, y: 560), startRadius: 0,
                       endCenter: CGPoint(x: 512, y: 560), endRadius: 470, options: [])

// Cloud: flat-bottomed pill plus three puffs. CG origin is bottom-left.
let cloud = [
    CGPath(roundedRect: CGRect(x: 172, y: 262, width: 680, height: 260), cornerWidth: 130, cornerHeight: 130, transform: nil),
    CGPath(rect: CGRect(x: 172, y: 392, width: 680, height: 38), transform: nil),
    CGPath(rect: CGRect(x: 592, y: 392, width: 260, height: 78), transform: nil),
    CGPath(ellipseIn: CGRect(x: 172, y: 300, width: 260, height: 260), transform: nil),
    CGPath(ellipseIn: CGRect(x: 592, y: 340, width: 260, height: 260), transform: nil),
    CGPath(ellipseIn: CGRect(x: 298, y: 384, width: 414, height: 414), transform: nil),
].reduce(CGMutablePath() as CGPath) { $0.union($1) }

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -26), blur: 60, color: p.shadow)
ctx.addPath(cloud); ctx.setFillColor(p.cloud[0]); ctx.fillPath()
ctx.restoreGState()
ctx.saveGState()
ctx.addPath(cloud); ctx.clip()
ctx.drawLinearGradient(gradient(p.cloud), start: CGPoint(x: 0, y: 798), end: CGPoint(x: 0, y: 262), options: [])
ctx.restoreGState()

// Prompt `>_` cut out of the cloud, so the background shows through.
let chevron = CGMutablePath()
chevron.move(to: CGPoint(x: 372, y: 534))
chevron.addLine(to: CGPoint(x: 474, y: 444))
chevron.addLine(to: CGPoint(x: 372, y: 354))
let prompt = chevron.copy(strokingWithWidth: 66, lineCap: .round, lineJoin: .round, miterLimit: 10).mutableCopy()!
let cursor = CGPath(roundedRect: CGRect(x: 520, y: 321, width: 160, height: 66), cornerWidth: 33, cornerHeight: 33,
                    transform: nil)
ctx.saveGState()
ctx.addPath(prompt); ctx.clip()
background()
ctx.restoreGState()
ctx.addPath(cursor); ctx.setFillColor(p.cursor); ctx.fillPath()

let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
