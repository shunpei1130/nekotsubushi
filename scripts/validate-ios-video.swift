import Foundation
import AVFoundation
let root=URL(fileURLWithPath:CommandLine.arguments[1])
let files=(FileManager.default.enumerator(at:root,includingPropertiesForKeys:nil)?.allObjects as? [URL] ?? []).filter{$0.pathExtension=="mp4"}
guard !files.isEmpty else {fatalError("Native TikTok export did not create an MP4")}
let asset=AVURLAsset(url:files[0])
let tracks=asset.tracks(withMediaType:.video)
guard let track=tracks.first,track.naturalSize==CGSize(width:1080,height:1920),abs(asset.duration.seconds-5)<0.1 else {fatalError("Invalid social video")}
print("PASS native MP4: 1080x1920, \(asset.duration.seconds)s, \(track.nominalFrameRate)fps")
