# @velarscript/docs-kit

Private documentation-product layer for the VelarScript website. It composes generic
`@velarscript/ui` layout primitives with the branded `@velarscript/site-ui`
package and owns documentation navigation, headers, prose, and callouts.

`Prose` owns the vertical rhythm of a page and owns it alone: it is a grid with
one declared gap, and every block it lays out — `Paragraph`, `SectionHeading`,
`Subheading`, `BulletList`, `CodeBlock`, `MemberTable`, `Callout` — declares
`margin = 0`. The larger space above a heading is the single exception, and it
is declared on the heading. A page composes those blocks; it never spells
spacing of its own.

It remains separate from both the Web framework and the theme-neutral UI
primitives.
