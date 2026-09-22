import SwiftUI

/// Plain field-list detail page shared by the simpler resource kinds.
struct KeyValueDetailView: View {
    let title: String
    let fields: [DetailField]

    var body: some View {
        List {
            Section("Details") {
                ForEach(fields, id: \.label) { field in
                    LabeledContent(field.label, value: field.value)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .navigationTitle(title)
    }
}
