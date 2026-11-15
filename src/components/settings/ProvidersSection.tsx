import clsx from 'clsx'
import { useState } from 'react'
import { ApiError } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import {
  detectPreset,
  isCustomPreset,
  kindOf,
  PROVIDER_KINDS,
  PROVIDER_PRESETS,
  presetsForKind,
  providerName,
  type ProviderKind,
  type ProviderPreset,
} from '../../services/providers/presets.js'
import { requestHostPermission } from '../../services/providers/hostPermission.js'
import { listModels } from '../../services/providers/stream.js'
import { PROTOCOL_LABELS, type Protocol, type ProviderConfig } from '../../services/providers/types.js'
import {
  removeProvider,
  saveProvider,
  selectProvider,
  useSettings,
} from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import { createId } from '../../utils/id.js'
import { Button } from '../base/Button.js'
import { IconEditOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { Select } from '../base/Select.js'
import styles from './Settings.module.css'

/** 模型平台：列表里切换当前平台，编辑页按「接入类型 → 服务平台」两级选择 */
export const ProvidersSection = () => {
  const [draft, setDraft] = useState<{ provider: ProviderConfig; isNew: boolean } | null>(null)
  if (draft) {
    return (
      <ProviderEditor initial={draft.provider} isNew={draft.isNew} onDone={() => setDraft(null)} />
    )
  }
  return (
    <ProviderList
      onEdit={(provider) => setDraft({ provider, isNew: false })}
      onAdd={() => setDraft({ provider: fromPreset(presetsForKind('openai')[0]), isNew: true })}
    />
  )
}

const fromPreset = (preset: ProviderPreset, base?: ProviderConfig): ProviderConfig => ({
  id: base?.id ?? createId(),
  name: preset.label,
  protocol: preset.protocol,
  baseUrl: preset.baseUrl,
  apiKey: base?.apiKey ?? '',
  model: preset.models[0] ?? '',
  models: preset.models,
})

const ProviderList = ({
  onEdit,
  onAdd,
}: {
  onEdit: (provider: ProviderConfig) => void
  onAdd: () => void
}) => {
  const t = useTranslate()
  const providers = useSettings((state) => state.providers)
  const activeId = useSettings((state) => state.activeProviderId)
  return (
    <>
      {providers.map((provider) => {
        const active = provider.id === activeId
        return (
          <div key={provider.id} className={clsx(styles.cell, styles.row)}>
            <div className={styles.text}>
              <div className={styles.label}>
                {provider.name}
                {active ? <span className={styles.providerBadge}>{t('providerInUse')}</span> : null}
              </div>
              <div className={clsx(styles.description, !provider.apiKey && styles.error)}>
                {[
                  PROTOCOL_LABELS[provider.protocol],
                  provider.model || t('providerNoModel'),
                  provider.apiKey ? '' : t('providerNoKey'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            {active ? null : (
              <Button
                variant="outlined"
                size="m"
                className={styles.cellButton}
                onClick={() => selectProvider(provider.id)}
              >
                {t('providerUse')}
              </Button>
            )}
            <IconButton
              size="m"
              icon={<IconEditOutline16 />}
              tooltip={t('providerEdit')}
              onClick={() => onEdit(provider)}
            />
          </div>
        )
      })}
      <div className={styles.providerAdd}>
        <Button variant="outlined" size="m" onClick={onAdd}>
          {t('providerAdd')}
        </Button>
      </div>
    </>
  )
}

const isLocalUrl = (url: string) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

const describeError = (t: ReturnType<typeof useTranslate>, error: unknown) => {
  if (classifyApiError(error) === 'network') {
    return t('providerCorsHint')
  }
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return t('providerKeyInvalid')
  }
  const message =
    error instanceof ApiError && error.localMessage
      ? t(error.localMessage.key, error.localMessage.params)
      : error instanceof ApiError
        ? `${error.status ? `HTTP ${error.status} ` : ''}${error.message}`
        : error instanceof Error
          ? error.message
          : String(error)
  return t('providerRequestFailed', { message })
}

const Field = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) => (
  <label className={styles.providerField}>
    <span className={styles.label}>{label}</span>
    {children}
    {hint ? <span className={styles.description}>{hint}</span> : null}
  </label>
)

const API_MODES: { value: Protocol; label: string }[] = [
  { value: 'openai-chat', label: 'Chat Completions' },
  { value: 'openai-responses', label: 'Responses' },
]

const ProviderEditor = ({
  initial,
  isNew,
  onDone,
}: {
  initial: ProviderConfig
  isNew: boolean
  onDone: () => void
}) => {
  const t = useTranslate()
  const providerCount = useSettings((state) => state.providers.length)
  const [provider, setProvider] = useState(initial)
  const [preset, setPreset] = useState(() => detectPreset(initial.protocol, initial.baseUrl))
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)
  const update = (patch: Partial<ProviderConfig>) => setProvider((value) => ({ ...value, ...patch }))
  const kind = kindOf(provider.protocol)
  const custom = isCustomPreset(preset)
  // 输入框同时充当筛选：输入的不是已有模型时，只显示包含该文字的模型
  const typed = provider.model.trim().toLowerCase()
  const visibleModels =
    typed && !provider.models.some((model) => model.toLowerCase() === typed)
      ? provider.models.filter((model) => model.toLowerCase().includes(typed))
      : provider.models

  const applyPreset = (next: ProviderPreset) => {
    setPreset(next)
    setProvider(fromPreset(next, provider))
    setStatus(null)
  }

  const fetchModels = async () => {
    // 本机服务（如 Ollama）一般不需要 Key，其余先提示填写，免得拿到一串看不懂的 401
    if (!provider.apiKey.trim() && !isLocalUrl(provider.baseUrl)) {
      setStatus({ text: t('providerKeyRequired'), error: true })
      return
    }
    // 必须在 await 之前申请，浏览器只认同一次点击里的申请
    const granted = requestHostPermission(provider.baseUrl)
    setBusy(true)
    setStatus(null)
    try {
      if (!(await granted)) {
        setStatus({ text: t('providerPermissionDenied'), error: true })
        return
      }
      const models = await listModels({ ...provider, apiKey: provider.apiKey.trim() })
      update({
        models,
        model: provider.model && models.includes(provider.model) ? provider.model : (models[0] ?? provider.model),
      })
      setStatus({ text: t('providerModelsFetched', { count: models.length }), error: false })
    } catch (error) {
      setStatus({ text: describeError(t, error), error: true })
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    void requestHostPermission(provider.baseUrl)
    const baseUrl = provider.baseUrl.trim().replace(/\/+$/, '')
    if (!baseUrl) {
      setStatus({ text: t('providerBaseUrlRequired'), error: true })
      return
    }
    const next = {
      ...provider,
      name: providerName(preset, baseUrl),
      baseUrl,
      apiKey: provider.apiKey.trim(),
      model: provider.model.trim(),
    }
    if (next.model && !next.models.includes(next.model)) {
      next.models = [next.model, ...next.models]
    }
    saveProvider(next)
    if (isNew) {
      selectProvider(next.id)
    }
    onDone()
  }

  return (
    <div className={styles.providerEditor}>
      <Field label={t('providerKind')} hint={PROVIDER_KINDS.find((item) => item.id === kind)?.hint}>
        <Select<ProviderKind>
          ariaLabel={t('providerKind')}
          value={kind}
          options={PROVIDER_KINDS.map((item) => ({ value: item.id, label: item.label }))}
          onChange={(next) => applyPreset(presetsForKind(next)[0])}
        />
      </Field>
      <Field label={t('providerService')}>
        <Select
          ariaLabel={t('providerService')}
          value={preset.id}
          options={presetsForKind(kind).map((item) => ({ value: item.id, label: item.label }))}
          onChange={(id) => applyPreset(PROVIDER_PRESETS.find((item) => item.id === id) ?? preset)}
        />
      </Field>
      {kind === 'openai' ? (
        <Field label={t('providerApiMode')}>
          <Select<Protocol>
            ariaLabel={t('providerApiMode')}
            value={provider.protocol}
            options={API_MODES}
            onChange={(protocol) => update({ protocol })}
          />
        </Field>
      ) : null}
      {custom ? (
        <Field
          label={t('providerBaseUrl')}
          hint={kind === 'openai' ? t('providerBaseUrlVersioned') : t('providerBaseUrlRoot')}
        >
          <div className={styles.apiKeyInput}>
            <input
              value={provider.baseUrl}
              spellCheck={false}
              placeholder="https://"
              onChange={(event) => update({ baseUrl: event.target.value })}
            />
          </div>
        </Field>
      ) : null}
      <Field label={t('providerApiKey')}>
        <div className={styles.apiKeyInput}>
          <input
            type="password"
            autoComplete="off"
            value={provider.apiKey}
            onChange={(event) => update({ apiKey: event.target.value })}
          />
        </div>
      </Field>
      <Field
        label={t('providerModel')}
        hint={provider.models.length > 0 ? t('providerModelCount', { count: provider.models.length }) : undefined}
      >
        <div className={styles.providerModelRow}>
          <div className={styles.apiKeyInput}>
            <input
              spellCheck={false}
              placeholder={t('providerModelPlaceholder')}
              value={provider.model}
              onChange={(event) => update({ model: event.target.value })}
            />
          </div>
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={busy || !provider.baseUrl.trim()}
            onClick={() => void fetchModels()}
          >
            {busy ? t('providerFetching') : t('providerFetchModels')}
          </Button>
        </div>
      </Field>
      {visibleModels.length > 0 ? (
        <div className={styles.providerModels}>
          {visibleModels.map((model) => (
            <button
              key={model}
              type="button"
              title={model}
              className={clsx(styles.providerModelChip, model === provider.model && styles.providerModelChipActive)}
              onClick={() => update({ model })}
            >
              {model}
            </button>
          ))}
        </div>
      ) : null}
      {status ? (
        <div className={clsx(styles.description, status.error && styles.error)}>{status.text}</div>
      ) : null}
      <div className={styles.providerActions}>
        {!isNew && providerCount > 1 ? (
          <Button
            variant="dangerOutlined"
            size="m"
            onClick={() => {
              removeProvider(provider.id)
              onDone()
            }}
          >
            {t('delete')}
          </Button>
        ) : null}
        <span className={styles.providerSpacer} />
        <Button variant="outlined" size="m" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button size="m" onClick={save}>
          {t('providerSave')}
        </Button>
      </div>
    </div>
  )
}
