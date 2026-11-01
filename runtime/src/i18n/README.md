# Product language

`UiLanguageProvider` owns the UI language. English is the first-run default; the language selector stores an explicit choice separately from model and prompt settings.

Use `useUiLanguage().t('English product copy')` for new labels, descriptions and accessible names. Add its Swedish translation to `SWEDISH_MESSAGES` in `productMessages.mjs`. Use positional placeholders, for example `t('Open task: {0}', [goal])`, so a translation can reorder values without editing JSX. Existing `tr(swedish, english)` calls remain supported by this same provider.

`LEGACY_PRODUCT_LABELS` adapts registered system messages from older runtimes and replaces historical component names in product copy. Template matching only recognizes registered product templates. Unknown strings and interpolated values remain unchanged. API identifiers, tool names, file paths, source code, user goals and model replies must not be translated.

The React rendering regression in `tests/nova/product-language.test.mjs` checks English first-run onboarding, explicit Swedish, permission controls, standardized system observations and unchanged user goals. Run it after installing the canonical runtime dependencies.
