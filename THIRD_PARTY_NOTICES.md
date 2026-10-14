# Third-party notices

The PolyForm Strict License 1.0.0 in [LICENSE](LICENSE) applies to the
first-party code in this repository only. Third-party material keeps its own
licence and notices, and is not relicensed by this repository.

## Derived from third-party code

| Component | Where | Licence | Text |
| --------- | ----- | ------- | ---- |
| [shadcn/ui](https://github.com/shadcn-ui/ui), Copyright (c) 2023 shadcn | `src/components/ui/`, `components.json` | MIT | [licenses/shadcn-ui-MIT.md](licenses/shadcn-ui-MIT.md) |

`src/components/ui/` was started with the shadcn CLI (`components.json`,
`new-york` style, no pinned version recorded). Only some of the files follow
the shadcn/ui structure and were then modified: those that wrap Radix UI
primitives or `class-variance-authority` variants, such as `button.tsx`,
`dialog.tsx`, `dropdown-menu.tsx`, `sheet.tsx`, `tooltip.tsx` and `sonner.tsx`.
Many other files in that directory (for example `alert-badge`, `approval-card`,
`donut`, `meter`, `stage-list`, `timeline`, `window-gauge`) are first-party
components with no shadcn/ui counterpart and carry only the PolyForm licence.
Radix UI and `sonner` are used as npm dependencies and are not copied.

## Loaded at build time

| Component | How | Licence |
| --------- | --- | ------- |
| Inter, JetBrains Mono | `next/font/google` (downloaded from Google Fonts during the build and self-hosted from the build output) | SIL Open Font License 1.1 (<https://openfontlicense.org>) |

The font files are not stored in this repository.

## Avatar artwork

Account avatars are drawn in the browser by [DiceBear](https://www.dicebear.com)
(`@dicebear/core`, MIT) with the `@dicebear/notionists` style. Its artwork is
"Notionists" by Zoish (<https://heyzoish.gumroad.com/l/notionists>), released
under CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>). Nothing is
fetched from a DiceBear server.

## Dependencies

npm dependencies are installed from the registry and are not vendored here;
each carries its own licence in its package. No GPL, AGPL, SSPL or BUSL
package was found in the installed tree. The packages below are transitive
dependencies of `@privy-io/react-auth` that are **not** under an OSI-approved
licence, or declare none. Licences are as found in each package's
`package.json` and `LICENSE` file at the versions pinned in `pnpm-lock.yaml`:

| Packages | Version | Licence |
| -------- | ------- | ------- |
| `@reown/appkit`, `@reown/appkit-common`, `-controllers`, `-pay`, `-polyfills`, `-scaffold-ui`, `-ui`, `-utils`, `-wallet` (9 packages) | 1.8.9 | Reown Community License Agreement (`SEE LICENSE IN LICENSE.md`). Custom terms: royalty-free for building applications, but modifications to the packages are assigned to Reown, and it has termination and redistribution clauses. Read it before republishing a build that contains these packages. |
| `@walletconnect/core`, `ethereum-provider`, `sign-client`, `types`, `universal-provider`, `utils` | 2.22.4 | Same Reown Community License Agreement (`SEE LICENSE IN LICENSE.md`). The other `@walletconnect/*` packages in the tree (`jsonrpc-*`, `keyvaluestorage`, `logger`, `time`, and so on) are MIT. |
| `@metamask/sdk`, `@metamask/sdk-communication-layer`, `@metamask/sdk-install-modal-web` | 0.33.1, 0.33.1, 0.32.1 | No `license` field; the `LICENSE` file is a ConsenSys Software Inc. licence that permits non-commercial use only and refers other uses to the vendor. |
| `@metamask/eth-json-rpc-provider` | 1.0.1 | No licence declared in the package. |
| `@privy-io/api-base` | 1.9.5 | No `license` field; its `LICENSE` file is Apache-2.0. |

Other `@metamask/*` packages in the tree are MIT or ISC.

Other licences present in the tree that are not plain MIT, ISC, BSD or
Apache-2.0: MPL-2.0 (file-level copyleft, unmodified), CC-BY-4.0 (`caniuse-lite`,
build time only), CC0-1.0, Python-2.0, and LGPL-3.0-or-later for the optional
native `@img/sharp-libvips-*` binaries used by `next/image` on the server.
