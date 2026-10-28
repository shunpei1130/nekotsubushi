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
        SocialVideoExport(image: image, outputURL: outputURL) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let url): call.resolve(["uri": url.absoluteString])
                case .failure(let error): call.reject("Video export failed", nil, error)
                }
            }
        }.start()
    }
}

/// Let AVFoundation schedule work when its encoder has room. Polling readiness can
/// stall a software encoder, and buffers must be unlocked before handing them over.
private final class SocialVideoExport {
    private let queue = DispatchQueue(label: "jp.shunpei1130.nekotsubushi.video", qos: .userInitiated)
    private let image: CGImage
    private let outputURL: URL
    private var completion: ((Result<URL, Error>) -> Void)?
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var watchdog: DispatchSourceTimer?
    private var frame = 0
    private var finishing = false
    private var finished = false

    init(image: CGImage, outputURL: URL, completion: @escaping (Result<URL, Error>) -> Void) {
        self.image = image; self.outputURL = outputURL; self.completion = completion
    }

    func start() { queue.async { self.begin() } }

    private func begin() {
        do {
            let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
            self.writer = writer
            let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 1080, AVVideoHeightKey: 1920,
                AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 4_000_000,
                                                 AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel]
            ])
            self.input = input
            input.expectsMediaDataInRealTime = false
            let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: 1080, kCVPixelBufferHeightKey as String: 1920,
                kCVPixelBufferCGImageCompatibilityKey as String: true,
                kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:]
            ])
            guard writer.canAdd(input) else { throw ExportError.encoder }
            writer.add(input)
            guard writer.startWriting() else { throw writer.error ?? ExportError.encoder }
            writer.startSession(atSourceTime: .zero)
            guard let pool = adaptor.pixelBufferPool else { throw ExportError.buffer }

            let timer = DispatchSource.makeTimerSource(queue: queue)
            watchdog = timer
            timer.schedule(deadline: .now() + 60)
            timer.setEventHandler { self.finish(.failure(ExportError.timeout(self.frame))) }
            timer.resume()
            input.requestMediaDataWhenReady(on: queue) {
                guard !self.finished && !self.finishing else { return }
                do {
                    while input.isReadyForMoreMediaData && self.frame < 150 {
                        let buffer = try autoreleasepool { try self.drawFrame(pool: pool) }
                        guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(self.frame), timescale: 30)) else {
                            throw writer.error ?? ExportError.encoder
                        }
                        self.frame += 1
                    }
                    if self.frame == 150 {
                        self.finishing = true
                        input.markAsFinished()
                        writer.endSession(atSourceTime: CMTime(value: 150, timescale: 30))
                        writer.finishWriting {
                            self.queue.async {
                                self.finish(writer.status == .completed ? .success(self.outputURL) : .failure(writer.error ?? ExportError.encoder))
                            }
                        }
                    }
                } catch { self.finish(.failure(error)) }
            }
        } catch { finish(.failure(error)) }
    }

    private func drawFrame(pool: CVPixelBufferPool) throws -> CVPixelBuffer {
        var value: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &value) == kCVReturnSuccess, let buffer = value,
              CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess else { throw ExportError.buffer }
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: 1080, height: 1920,
                                      bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue) else { throw ExportError.buffer }
        context.setFillColor(UIColor(red: 1, green: 0.965, blue: 0.9, alpha: 1).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: 1080, height: 1920))
        let width = 1000 * (1 + 0.025 * sin(Double(frame) / 149 * .pi))
        let height = width * Double(image.height) / Double(image.width)
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: (1080-width)/2, y: (1920-height)/2, width: width, height: height))
        return buffer
    }

    private func finish(_ result: Result<URL, Error>) {
        guard !finished else { return }
        finished = true
        watchdog?.setEventHandler {}; watchdog?.cancel(); watchdog = nil
        input?.stopRequestingMediaData()
        if case .failure = result {
            if writer?.status == .writing { writer?.cancelWriting() }
            try? FileManager.default.removeItem(at: outputURL)
        }
        #if DEBUG
        switch result {
        case .success: NSLog("neko-video: exported %d frames", frame)
        case .failure(let error): NSLog("neko-video: failed at frame %d: %@", frame, error.localizedDescription)
        }
        #endif
        completion?(result); completion = nil
    }

    private enum ExportError: LocalizedError {
        case encoder, buffer, timeout(Int)
        var errorDescription: String? {
            switch self {
            case .encoder: return "The video encoder could not accept a frame."
            case .buffer: return "The video frame could not be prepared."
            case .timeout(let frame): return "Video export timed out after \(frame) of 150 frames."
            }
        }
    }
}
