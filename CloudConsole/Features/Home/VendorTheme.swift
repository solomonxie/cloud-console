import SwiftUI

extension CloudVendor {
    var accentColor: Color {
        switch self {
        case .aws: return .orange
        case .azure: return .blue
        case .gcp: return .red
        case .tencent: return .teal
        case .alibaba: return .pink
        }
    }
}

/// Rounded, colored icon badge — same shape as iOS Settings rows.
struct VendorBadge: View {
    let systemImage: String
    let color: Color
    var size: CGFloat = 32

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(color.gradient)
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: systemImage)
                    .font(.system(size: size * 0.5))
                    .foregroundStyle(.white)
            }
    }
}
