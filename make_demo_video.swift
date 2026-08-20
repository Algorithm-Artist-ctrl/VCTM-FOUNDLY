import Foundation
import AVFoundation
import AppKit

let width = 1280
let height = 720
let fps = 30
let secondsPerScene = 4
let output = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("VCTM-Foundly-demo.mp4")
try? FileManager.default.removeItem(at: output)

let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let settings: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
let attributes: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height, kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true]
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)
writer.add(input)

struct Scene { let kicker: String; let title: String; let body: String; let accent: NSColor; let step: String }
let scenes = [
    Scene(kicker: "VIVEKANANDA COLLEGE OF TECHNOLOGY & MANAGEMENT", title: "VCTM Foundly", body: "A safe campus space for lost items to find their way home.", accent: NSColor(calibratedRed: 0.93, green: 0.43, blue: 0.36, alpha: 1), step: "01"),
    Scene(kicker: "LOST ITEM REPORT", title: "Aarav loses his backpack", body: "He signs in with his VCTM account and reports the item with location and details.", accent: NSColor(calibratedRed: 0.93, green: 0.43, blue: 0.36, alpha: 1), step: "02"),
    Scene(kicker: "FOUND ITEM REPORT", title: "Meera finds a backpack", body: "She posts where she found it, without sharing personal contact details.", accent: NSColor(calibratedRed: 0.26, green: 0.49, blue: 0.41, alpha: 1), step: "03"),
    Scene(kicker: "SMART MATCHING", title: "A possible match is found", body: "Foundly compares the item name, category and location to suggest a 96% match.", accent: NSColor(calibratedRed: 0.48, green: 0.39, blue: 0.82, alpha: 1), step: "04"),
    Scene(kicker: "SAFE CONNECTION", title: "Aarav sends a request", body: "He explains why the backpack is his. Meera can accept or decline the request.", accent: NSColor(calibratedRed: 0.93, green: 0.43, blue: 0.36, alpha: 1), step: "05"),
    Scene(kicker: "VERIFIED HANDOFF", title: "Meera accepts the request", body: "Both verified VCTM members can now arrange a safe return at the Student Centre.", accent: NSColor(calibratedRed: 0.26, green: 0.49, blue: 0.41, alpha: 1), step: "06"),
    Scene(kicker: "ITEM RETURNED", title: "Backpack reunited with Aarav", body: "One report, one safe connection, one happy reunion.", accent: NSColor(calibratedRed: 0.26, green: 0.49, blue: 0.41, alpha: 1), step: "✓")
]

func drawText(_ text: String, at point: CGPoint, font: NSFont, color: NSColor, context: CGContext) {
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    let line = NSAttributedString(string: text, attributes: attributes)
    let lineRef = CTLineCreateWithAttributedString(line)
    context.textPosition = point
    CTLineDraw(lineRef, context)
}

func drawWrapped(_ text: String, x: CGFloat, y: CGFloat, width: CGFloat, font: NSFont, color: NSColor, context: CGContext) {
    let words = text.split(separator: " ").map(String.init); var line = ""; var offset: CGFloat = 0
    for word in words {
        let candidate = line.isEmpty ? word : line + " " + word
        if (candidate as NSString).size(withAttributes: [.font: font]).width > width && !line.isEmpty {
            drawText(line, at: CGPoint(x: x, y: y - offset), font: font, color: color, context: context); offset += font.pointSize * 1.45; line = word
        } else { line = candidate }
    }
    if !line.isEmpty { drawText(line, at: CGPoint(x: x, y: y - offset), font: font, color: color, context: context) }
}

func render(scene: Scene, progress: CGFloat) -> CVPixelBuffer? {
    var pixelBuffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pixelBuffer)
    guard let buffer = pixelBuffer else { return nil }
    CVPixelBufferLockBaseAddress(buffer, [])
    guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { return nil }
    context.setFillColor(NSColor(calibratedRed: 0.96, green: 0.95, blue: 0.92, alpha: 1).cgColor); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.setFillColor(NSColor(calibratedRed: 0.07, green: 0.14, blue: 0.25, alpha: 1).cgColor); context.fill(CGRect(x: 0, y: 0, width: 480, height: height))
    let alpha = min(1, progress * 5, (1 - progress) * 5)
    context.setAlpha(alpha)
    drawText("VCTM Foundly", at: CGPoint(x: 60, y: 650), font: NSFont.systemFont(ofSize: 26, weight: .bold), color: .white, context: context)
    drawText(scene.kicker, at: CGPoint(x: 60, y: 525), font: NSFont.monospacedSystemFont(ofSize: 13, weight: .semibold), color: NSColor(calibratedWhite: 0.77, alpha: 1), context: context)
    drawWrapped(scene.title, x: 60, y: 415, width: 355, font: NSFont.systemFont(ofSize: 47, weight: .bold), color: .white, context: context)
    drawWrapped(scene.body, x: 60, y: 265, width: 350, font: NSFont.systemFont(ofSize: 19, weight: .regular), color: NSColor(calibratedWhite: 0.8, alpha: 1), context: context)
    context.setFillColor(scene.accent.cgColor); context.fillEllipse(in: CGRect(x: 875, y: 180, width: 260, height: 260))
    context.setFillColor(NSColor.white.cgColor); context.fillRoundedRect(in: CGRect(x: 730, y: 155, width: 190, height: 245), cornerWidth: 20, cornerHeight: 20)
    context.setFillColor(NSColor(calibratedRed: 0.10, green: 0.16, blue: 0.26, alpha: 1).cgColor); context.fillRoundedRect(in: CGRect(x: 760, y: 308, width: 130, height: 64), cornerWidth: 12, cornerHeight: 12)
    context.setStrokeColor(scene.accent.cgColor); context.setLineWidth(9); context.strokeEllipse(in: CGRect(x: 782, y: 338, width: 84, height: 64))
    drawText(scene.step, at: CGPoint(x: 1005, y: 280), font: NSFont.systemFont(ofSize: 80, weight: .bold), color: .white, context: context)
    drawText("REPORT  •  MATCH  •  CONNECT  •  RETURN", at: CGPoint(x: 570, y: 90), font: NSFont.monospacedSystemFont(ofSize: 14, weight: .medium), color: NSColor(calibratedRed: 0.38, green: 0.44, blue: 0.52, alpha: 1), context: context)
    context.setAlpha(1); CVPixelBufferUnlockBaseAddress(buffer, []); return buffer
}

writer.startWriting(); writer.startSession(atSourceTime: .zero)
for (sceneIndex, scene) in scenes.enumerated() {
    for frame in 0..<(fps * secondsPerScene) {
        while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.01) }
        let progress = CGFloat(frame) / CGFloat(fps * secondsPerScene)
        if let buffer = render(scene: scene, progress: progress) { adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(sceneIndex * fps * secondsPerScene + frame), timescale: CMTimeScale(fps))) }
    }
}
input.markAsFinished(); writer.finishWriting { print("Created \(output.path)") }
RunLoop.current.run(until: Date(timeIntervalSinceNow: 3))
