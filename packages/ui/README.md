# @velarscript/ui

Private dogfood package for small, theme-neutral Velar Web primitives. It owns
accessibility, interaction, and layout behavior, not the Velar brand palette or
documentation product structure.

The 0.2 surface exports `VisuallyHidden`, `SkipLink`, `Stack`, `Inline`,
`Status`, `Disclosure`, `ModalDialog`, and `TextField`. Interactive primitives
prefer native browser behavior and use checked Web capability modules rather
than an untyped DOM adapter. The package publishes one checked Velar source
entry and declares the Web framework as a peer contract. It remains private
until the API has survived real application use.
