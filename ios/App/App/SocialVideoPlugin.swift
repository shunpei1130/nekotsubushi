import Foundation
import AVFoundation
import UIKit
import Capacitor

@objc(SocialVideoPlugin)
public class SocialVideoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SocialVideoPlugin"
    public let jsName = "SocialVideo"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "exportVideo", returnType: CAPPluginReturnPromise)]

    @objc func exportVideo(_ call: CAPPluginCall) {
        guard let path = call.getString("imagePath"), let inputURL = URL(string: path), inputURL.isFileURL,
              let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
              inputURL.standardizedFileURL.path.hasPrefix(cache.standardizedFileURL.path + "/"),
              let image = UIImage(contentsOfFile: inputURL.path)?.cgImage else {
            call.reject("The prepared share image is unavailable"); return
        }
        let outputURL = inputURL.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + ".mp4")
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
                let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
                    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 1080, AVVideoHeightKey: 1920,
                    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 4_000_000,
                                                     AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel]
                ])
                input.expectsMediaDataInRealTime = false
                let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
                    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
                    kCVPixelBufferWidthKey as String: 1080, kCVPixelBufferHeightKey as String: 1920,
                    kCVPixelBufferCGImageCompatibilityKey as String: true,
                    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
                ])
                guard writer.canAdd(input) else { throw ExportError.failed }
                writer.add(input)
                guard writer.startWriting() else { throw writer.error ?? ExportError.failed }
                writer.startSession(atSourceTime: .zero)
                guard let pool = adaptor.pixelBufferPool else { throw ExportError.failed }
                for frame in 0..<150 {
                    while !input.isReadyForMoreMediaData {
                        if writer.status == .failed || writer.status == .cancelled { throw writer.error ?? ExportError.failed }
                        Thread.sleep(forTimeInterval: 0.002)
                    }
                    try autoreleasepool {
                        var value: CVPixelBuffer?
                        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &value) == kCVReturnSuccess, let buffer = value else { throw ExportError.failed }
                        CVPixelBufferLockBaseAddress(buffer, [])
                        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
                        guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: 1080, height: 1920,
                                                      bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { throw ExportError.failed }
                        context.setFillColor(UIColor(red: 1, green: 0.965, blue: 0.9, alpha: 1).cgColor)
                        context.fill(CGRect(x: 0, y: 0, width: 1080, height: 1920))
                        let zoom = 1 + 0.025 * sin(Double(frame) / 149 * .pi)
                        let width = 1000 * zoom
                        let height = width * Double(image.height) / Double(image.width)
                        context.interpolationQuality = .high
                        context.draw(image, in: CGRect(x: (1080-width)/2, y: (1920-height)/2, width: width, height: height))
                        guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: 30)) else { throw writer.error ?? ExportError.failed }
                    }
                }
                input.markAsFinished()
                writer.finishWriting {
                    DispatchQueue.main.async {
                        if writer.status == .completed { call.resolve(["uri": outputURL.absoluteString]) }
                        else { try? FileManager.default.removeItem(at: outputURL); call.reject("Video export failed", nil, writer.error) }
                    }
                }
            } catch { try? FileManager.default.removeItem(at: outputURL); DispatchQueue.main.async { call.reject("Video export failed", nil, error) } }
        }
    }
    private enum ExportError: Error { case failed }
}
