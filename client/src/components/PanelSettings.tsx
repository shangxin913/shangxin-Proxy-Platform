import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Eye,
  EyeOff,
  Github,
  Info,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Save,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import "../styles/admin.css";

export interface SafeSettings {
  adminPort: number;
  listenAddress: string;
  managementPath: string;
  passwordConfigured: boolean;
  revision: number;
  runtime: "managed" | "vps";
  networkEditable: boolean;
  version: string;
  proxyEnabled: boolean;
}

export interface PanelSettingsProps {
  onSessionInvalidated?: () => void;
}

type SettingsResult = {
  settings: SafeSettings;
  sessionInvalidated: boolean;
  networkChanged: boolean;
  managementPath: string;
};

const RELEASES_URL =
  "https://github.com/shangxin913/shangxin-Proxy-Platform/releases";
const MANAGEMENT_PATH_PATTERN = /^(?:\/|\/[A-Za-z0-9_-]+)$/;

function isSafeSettings(value: unknown): value is SafeSettings {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.adminPort === "number" &&
    Number.isInteger(data.adminPort) &&
    typeof data.listenAddress === "string" &&
    typeof data.managementPath === "string" &&
    MANAGEMENT_PATH_PATTERN.test(data.managementPath) &&
    typeof data.passwordConfigured === "boolean" &&
    typeof data.revision === "number" &&
    Number.isInteger(data.revision) &&
    (data.runtime === "managed" || data.runtime === "vps") &&
    typeof data.networkEditable === "boolean" &&
    typeof data.version === "string" &&
    typeof data.proxyEnabled === "boolean"
  );
}

function isLoopback(address: string) {
  const normalized = address.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

export function PanelSettings({ onSessionInvalidated }: PanelSettingsProps) {
  const fieldId = useId();
  const noticeRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<SafeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [adminPort, setAdminPort] = useState("");
  const [listenAddress, setListenAddress] = useState("");
  const [managementPath, setManagementPath] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sshNotice, setSshNotice] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const networkEditable =
    settings?.runtime === "vps" && settings.networkEditable;

  function populate(value: SafeSettings) {
    setSettings(value);
    setAdminPort(String(value.adminPort));
    setListenAddress(value.listenAddress);
    setManagementPath(value.managementPath);
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch("/api/admin/settings", {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data?.error || "无法加载设置，请检查管理员会话。");
        if (!isSafeSettings(data))
          throw new Error("设置数据格式不正确，请稍后重试。");
        if (!controller.signal.aborted) populate(data);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "网络连接失败，请重试。"
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reload]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || saving || sessionExpired) return;
    setError("");
    setNotice("");
    setSshNotice("");
    const nextPort = networkEditable ? Number(adminPort) : settings.adminPort;
    const nextAddress = networkEditable
      ? listenAddress.trim()
      : settings.listenAddress;
    const nextPath = managementPath.trim();
    if (
      networkEditable &&
      (!/^\d+$/.test(adminPort) ||
        !Number.isInteger(nextPort) ||
        nextPort < 1024 ||
        nextPort > 65535)
    ) {
      setError("管理端口必须是 1024–65535 之间的整数。");
      return;
    }
    if (!nextAddress || nextAddress.length > 253) {
      setError("请输入有效的监听 IP 地址或 localhost。");
      return;
    }
    if (!MANAGEMENT_PATH_PATTERN.test(nextPath)) {
      setError(
        "管理路径只能是 / 或单段路径，例如 /admin；仅支持字母、数字、下划线和连字符。"
      );
      return;
    }
    if (settings.passwordConfigured && !currentPassword) {
      setError("请输入当前管理密码，以确认本次敏感设置变更。");
      return;
    }
    if (!settings.passwordConfigured && !newPassword) {
      setError("首次配置必须设置管理密码，长度为 12–256 个字符。");
      return;
    }
    if (newPassword && (newPassword.length < 12 || newPassword.length > 256)) {
      setError("新密码长度必须为 12–256 个字符。");
      return;
    }

    const networkWillChange =
      nextPort !== settings.adminPort || nextAddress !== settings.listenAddress;
    const pathWillChange = nextPath !== settings.managementPath;
    if (networkWillChange || pathWillChange) {
      const warnings = [
        "更改管理入口可能导致当前连接中断或无法再次访问。请确认拥有 SSH 或服务器控制台访问权限，并已核对防火墙及反向代理配置。",
        pathWillChange
          ? `管理路径：${settings.managementPath} → ${nextPath}`
          : "",
        networkWillChange
          ? `监听地址：${settings.listenAddress} → ${nextAddress}\n管理端口：${settings.adminPort} → ${nextPort}`
          : "",
        networkWillChange && isLoopback(nextAddress)
          ? "注意：127.0.0.1、::1 或 localhost 仅允许服务器本机访问。公网地址不能直接访问该监听服务；需要 SSH 端口转发或正确配置的反向代理。"
          : "",
        settings.proxyEnabled && networkWillChange
          ? "已启用反向代理：外部端口保持不变，但可能需要同步调整代理上游。"
          : "",
        "确认保存这些设置？",
      ]
        .filter(Boolean)
        .join("\n\n");
      if (!window.confirm(warnings)) return;
    }

    setSaving(true);
    let result: SettingsResult;
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-exitpanel-action": "1",
        },
        body: JSON.stringify({
          adminPort: nextPort,
          listenAddress: nextAddress,
          managementPath: nextPath,
          currentPassword,
          newPassword,
          revision: settings.revision,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data?.error || "保存失败，请检查设置后重试。");
      if (
        !isSafeSettings(data?.settings) ||
        typeof data.sessionInvalidated !== "boolean" ||
        typeof data.networkChanged !== "boolean" ||
        typeof data.managementPath !== "string" ||
        !MANAGEMENT_PATH_PATTERN.test(data.managementPath)
      ) {
        throw new Error(
          "服务器未返回有效的保存结果，请重新加载设置核实；不要重复提交。"
        );
      }
      result = data;
      populate(result.settings);
      setCurrentPassword("");
      setNewPassword("");
      setShowCurrent(false);
      setShowNew(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "连接已中断。入口可能已改变，请通过 SSH 核实配置后再访问，避免重复保存。"
      );
      setSaving(false);
      return;
    }
    setSaving(false);

    // Use only the browser's public origin; never construct a URL from the server's listen address.
    const destination = new URL(window.location.origin);
    destination.pathname = result.managementPath;
    if (
      result.settings.runtime === "vps" &&
      !result.settings.proxyEnabled &&
      result.settings.adminPort !== settings.adminPort
    ) {
      destination.port = String(result.settings.adminPort);
    }
    const needsSsh =
      result.settings.runtime === "vps" &&
      !result.settings.proxyEnabled &&
      result.networkChanged &&
      isLoopback(result.settings.listenAddress);
    const endpointChanged =
      result.managementPath !== settings.managementPath ||
      (result.settings.runtime === "vps" &&
        !result.settings.proxyEnabled &&
        result.settings.adminPort !== settings.adminPort);

    if (result.networkChanged && isLoopback(result.settings.listenAddress)) {
      const message = `监听已改为本机地址 ${result.settings.listenAddress}:${result.settings.adminPort}。请通过 SSH 端口转发访问，例如将本地端口转发至服务器 127.0.0.1:${result.settings.adminPort}（IPv6 监听请使用 ::1），然后访问本地转发端口上的 ${result.managementPath}。如使用反向代理，请核对代理上游；公网地址不能直接访问本机监听。`;
      setSshNotice(message);
      if (needsSsh) window.alert(message);
    }
    setSessionExpired(result.sessionInvalidated);
    setNotice(
      result.sessionInvalidated
        ? "设置已保存，管理密码已更新。当前会话已失效，请使用新密码重新登录。"
        : "设置已保存。"
    );

    // A full navigation handles the new endpoint AND the invalidated session, without racing a logout callback.
    if (endpointChanged && !needsSsh) {
      window.location.assign(destination.toString());
      return;
    }
    if (result.sessionInvalidated && onSessionInvalidated) {
      onSessionInvalidated();
      return;
    }
    noticeRef.current?.focus();
  }

  return (
    <section
      className="panel-settings-page"
      aria-labelledby={`${fieldId}-title`}
    >
      <header className="panel-settings-header">
        <p className="panel-settings-eyebrow">PREFERENCES</p>
        <h1 id={`${fieldId}-title`}>设置</h1>
        <p>管理你的控制台入口与安全偏好。</p>
      </header>

      <section
        className="panel-settings-card panel-settings-version"
        aria-labelledby={`${fieldId}-version-title`}
      >
        <div className="panel-settings-version-copy">
          <div className="panel-settings-card-icon">
            <ArrowUpRight size={21} aria-hidden="true" />
          </div>
          <div>
            <h2 id={`${fieldId}-version-title`}>版本与更新</h2>
            <p>查看当前版本和发布记录，按部署方式手动更新。</p>
          </div>
        </div>
        <div className="panel-settings-version-actions">
          <span className="panel-settings-version-badge">
            {settings
              ? `v${settings.version.replace(/^v/i, "")}`
              : loading
                ? "读取版本…"
                : "版本未读取"}
          </span>
          <a
            className="panel-settings-release-link"
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github size={15} aria-hidden="true" />
            版本记录
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </section>

      <div className="panel-settings-grid">
        <section
          className="panel-settings-card panel-settings-management"
          aria-labelledby={`${fieldId}-management-title`}
        >
          <header className="panel-settings-card-header">
            <div className="panel-settings-card-icon">
              <Settings2 size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 id={`${fieldId}-management-title`}>管理入口</h2>
              <p>为控制台设置独立入口与管理密码。</p>
            </div>
            {settings && (
              <span className="panel-settings-runtime">
                {settings.runtime === "managed" ? "托管平台" : "VPS 部署"}
              </span>
            )}
          </header>
          {loading ? (
            <div className="panel-settings-loading" role="status">
              <LoaderCircle
                size={20}
                className="panel-settings-spinner"
                aria-hidden="true"
              />
              正在加载安全设置…
            </div>
          ) : !settings ? (
            <div className="panel-settings-load-error">
              <p role="alert">{error || "设置暂时不可用。"}</p>
              <button
                className="panel-settings-secondary-button"
                type="button"
                onClick={() => setReload(value => value + 1)}
              >
                重新加载
              </button>
            </div>
          ) : (
            <form
              className="panel-settings-form"
              onSubmit={handleSubmit}
              aria-busy={saving}
            >
              <fieldset
                className="panel-settings-fieldset"
                disabled={saving || sessionExpired}
              >
                <legend className="panel-settings-sr-only">管理入口设置</legend>
                <div className="panel-settings-two-columns">
                  <div className="panel-settings-field">
                    <label htmlFor={`${fieldId}-port`}>管理端口</label>
                    <input
                      id={`${fieldId}-port`}
                      type="number"
                      min={1024}
                      max={65535}
                      step={1}
                      inputMode="numeric"
                      value={adminPort}
                      onChange={event => setAdminPort(event.target.value)}
                      disabled={!networkEditable}
                      required
                      aria-describedby={`${fieldId}-network-note`}
                    />
                    <small>端口范围 1024–65535</small>
                  </div>
                  <div className="panel-settings-field">
                    <label htmlFor={`${fieldId}-listen`}>监听地址</label>
                    <input
                      id={`${fieldId}-listen`}
                      type="text"
                      value={listenAddress}
                      onChange={event => setListenAddress(event.target.value)}
                      disabled={!networkEditable}
                      placeholder="0.0.0.0"
                      maxLength={253}
                      required
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-describedby={`${fieldId}-network-note`}
                    />
                    <small>IP 地址或 localhost，由服务器校验</small>
                  </div>
                </div>
                <p
                  className="panel-settings-inline-note"
                  id={`${fieldId}-network-note`}
                >
                  <Info size={14} aria-hidden="true" />
                  <span>
                    {settings.runtime === "managed"
                      ? "端口与监听地址由托管平台控制，无法在此更改。"
                      : !networkEditable
                        ? "当前部署未开放网络设置编辑，请由服务器管理员配置。"
                        : settings.proxyEnabled
                          ? "已启用反向代理。更改内部监听时，请同步核对代理上游；外部访问端口不变。"
                          : "更改网络设置可能中断访问。127.0.0.1 或 localhost 仅允许服务器本机连接。"}
                  </span>
                </p>
                <div className="panel-settings-field">
                  <label htmlFor={`${fieldId}-path`}>管理路径</label>
                  <input
                    id={`${fieldId}-path`}
                    type="text"
                    value={managementPath}
                    onChange={event => setManagementPath(event.target.value)}
                    placeholder="/admin"
                    pattern="/|/[A-Za-z0-9_-]+"
                    required
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-describedby={`${fieldId}-path-hint`}
                  />
                  <small id={`${fieldId}-path-hint`}>
                    使用 / 或单段路径，如
                    /admin。路径不是访问密码，请勿只依赖隐藏入口。
                  </small>
                </div>
                <div className="panel-settings-divider" />
                <div className="panel-settings-security-label">
                  <KeyRound size={15} aria-hidden="true" />
                  <span>访问安全</span>
                  <span className="panel-settings-password-status">
                    {settings.passwordConfigured ? "已设置密码" : "首次配置"}
                  </span>
                </div>
                {settings.passwordConfigured && (
                  <div className="panel-settings-field">
                    <label htmlFor={`${fieldId}-current`}>
                      当前密码{" "}
                      <span className="panel-settings-required">必填</span>
                    </label>
                    <div className="panel-settings-password-wrap">
                      <input
                        id={`${fieldId}-current`}
                        name="currentPassword"
                        type={showCurrent ? "text" : "password"}
                        value={currentPassword}
                        onChange={event =>
                          setCurrentPassword(event.target.value)
                        }
                        autoComplete="current-password"
                        maxLength={256}
                        placeholder="输入当前管理密码以确认变更"
                        required
                      />
                      <button
                        className="panel-settings-visibility"
                        type="button"
                        aria-label={
                          showCurrent ? "隐藏当前密码" : "显示当前密码"
                        }
                        aria-pressed={showCurrent}
                        onClick={() => setShowCurrent(value => !value)}
                      >
                        {showCurrent ? (
                          <EyeOff size={16} aria-hidden="true" />
                        ) : (
                          <Eye size={16} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    <small>保存敏感设置前，需要验证当前管理密码。</small>
                  </div>
                )}
                <div className="panel-settings-field">
                  <label htmlFor={`${fieldId}-new`}>
                    新密码
                    {!settings.passwordConfigured && (
                      <span className="panel-settings-required">必填</span>
                    )}
                  </label>
                  <div className="panel-settings-password-wrap">
                    <input
                      id={`${fieldId}-new`}
                      name="newPassword"
                      type={showNew ? "text" : "password"}
                      value={newPassword}
                      onChange={event => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={256}
                      placeholder={
                        settings.passwordConfigured
                          ? "留空则保留原密码"
                          : "设置你的第一个管理密码"
                      }
                      required={!settings.passwordConfigured}
                    />
                    <button
                      className="panel-settings-visibility"
                      type="button"
                      aria-label={showNew ? "隐藏新密码" : "显示新密码"}
                      aria-pressed={showNew}
                      onClick={() => setShowNew(value => !value)}
                    >
                      {showNew ? (
                        <EyeOff size={16} aria-hidden="true" />
                      ) : (
                        <Eye size={16} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <small>
                    12–256 个字符。
                    {settings.passwordConfigured
                      ? "留空保留原密码；"
                      : "首次配置必须设置；"}
                    更新密码后需要重新登录。
                  </small>
                </div>
              </fieldset>
              {error && (
                <div
                  className="panel-settings-message panel-settings-error"
                  role="alert"
                >
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}
              {notice && (
                <div
                  ref={noticeRef}
                  tabIndex={-1}
                  className="panel-settings-message panel-settings-success"
                  role="status"
                >
                  <Check size={16} aria-hidden="true" />
                  <span>{notice}</span>
                </div>
              )}
              {sshNotice && (
                <div
                  className="panel-settings-message panel-settings-warning"
                  role="status"
                >
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{sshNotice}</span>
                </div>
              )}
              <footer className="panel-settings-form-footer">
                <p>
                  <LockKeyhole size={13} aria-hidden="true" />
                  密码不会在浏览器本地保存
                </p>
                {sessionExpired && !onSessionInvalidated ? (
                  <button
                    type="button"
                    className="panel-settings-save-button"
                    onClick={() => window.location.reload()}
                  >
                    重新登录
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="panel-settings-save-button"
                    disabled={saving || sessionExpired}
                  >
                    {saving ? (
                      <LoaderCircle
                        size={16}
                        className="panel-settings-spinner"
                        aria-hidden="true"
                      />
                    ) : (
                      <Save size={16} aria-hidden="true" />
                    )}
                    {saving ? "正在保存…" : "保存设置"}
                  </button>
                )}
              </footer>
            </form>
          )}
        </section>

        <aside
          className="panel-settings-card panel-settings-brand"
          aria-label="关于 ExitPanel"
        >
          <div className="panel-settings-brand-mark">
            EP
            <span />
          </div>
          <p className="panel-settings-eyebrow">BUILT FOR YOUR CONNECTIONS</p>
          <h2>ExitPanel</h2>
          <p className="panel-settings-brand-description">
            让每一次连接，
            <br />
            都清晰可控。
          </p>
          <p className="panel-settings-brand-detail">
            一个专注于出口代理与连接管理的轻量控制台。将入口、出口和节点状态放在一起，让日常管理更简单。
          </p>
          <div className="panel-settings-brand-footer">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>私有部署 · 管理员专属</span>
          </div>
          <a
            className="panel-settings-brand-link"
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            在 GitHub 查看发布记录
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </aside>
      </div>
    </section>
  );
}

export default PanelSettings;
