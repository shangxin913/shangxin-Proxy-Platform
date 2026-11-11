import { useEffect, useId, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { startLogin } from "../const";
import "../styles/admin.css";

export interface AdminLoginProps {
  onSuccess: () => void;
}

type AdminStatus = { configured: boolean; runtime: "managed" | "vps" };

export function AdminLogin({ onSuccess }: AdminLoginProps) {
  const passwordId = useId();
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setStatusLoading(true);
    setError("");
    setStatus(null);
    void (async () => {
      try {
        const response = await fetch("/api/admin/status", {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data?.error || "暂时无法读取管理入口状态，请重试。");
        if (
          typeof data?.configured !== "boolean" ||
          !["managed", "vps"].includes(data?.runtime)
        ) {
          throw new Error("管理入口返回了无效状态，请稍后重试。");
        }
        if (!controller.signal.aborted) setStatus(data);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "网络连接失败，请重试。"
          );
        }
      } finally {
        if (!controller.signal.aborted) setStatusLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reload]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !status?.configured) return;
    if (!password) {
      setError("请输入管理密码。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-exitpanel-action": "1",
        },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok || data?.ok !== true) {
        throw new Error(data?.error || "登录失败，请检查管理密码后重试。");
      }
      setPassword("");
      setVisible(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "网络连接失败，请稍后重试。"
      );
      setBusy(false);
      return;
    }
    setBusy(false);
    onSuccess();
  }

  function handleOwnerLogin() {
    if (status?.configured !== false) return;
    try {
      startLogin();
    } catch {
      setError("此环境尚未配置所有者登录，请通过服务器初始化管理员密码。");
    }
  }

  return (
    <main className="admin-login-shell">
      <section
        className="admin-login-card"
        aria-labelledby={`${passwordId}-title`}
      >
        <div className="admin-login-icon">
          <LockKeyhole size={28} strokeWidth={1.8} aria-hidden="true" />
        </div>
        <p className="admin-login-eyebrow">EXITPANEL · 管理入口</p>
        <h1 id={`${passwordId}-title`} className="admin-login-title">
          欢迎回来
        </h1>
        <p className="admin-login-description">登录，继续管理你的连接。</p>
        <form
          className="admin-login-form"
          onSubmit={handleSubmit}
          aria-busy={busy || statusLoading}
        >
          <label className="admin-login-label" htmlFor={passwordId}>
            管理密码
          </label>
          <div className="admin-login-input-wrap">
            <input
              id={passwordId}
              className="admin-login-input"
              type={visible ? "text" : "password"}
              name="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="请输入管理密码"
              autoComplete="current-password"
              maxLength={256}
              required={status?.configured === true}
              disabled={busy || statusLoading || status?.configured !== true}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${passwordId}-error` : undefined}
            />
            <button
              className="admin-login-visibility"
              type="button"
              onClick={() => setVisible(value => !value)}
              aria-label={visible ? "隐藏管理密码" : "显示管理密码"}
              aria-pressed={visible}
              disabled={busy || status?.configured !== true}
            >
              {visible ? (
                <EyeOff size={17} aria-hidden="true" />
              ) : (
                <Eye size={17} aria-hidden="true" />
              )}
              <span>{visible ? "隐藏" : "显示"}</span>
            </button>
          </div>
          {error && (
            <p
              id={`${passwordId}-error`}
              className="admin-login-error"
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            className="admin-login-submit"
            type="submit"
            disabled={busy || statusLoading || !status?.configured}
          >
            {busy || statusLoading ? (
              <LoaderCircle
                className="admin-login-spinner"
                size={18}
                aria-hidden="true"
              />
            ) : null}
            <span>
              {statusLoading
                ? "读取入口状态…"
                : busy
                  ? "正在登录…"
                  : "进入控制台"}
            </span>
            {!busy && !statusLoading && (
              <ArrowRight size={18} aria-hidden="true" />
            )}
          </button>
        </form>
        {!statusLoading && !status && (
          <button
            type="button"
            className="admin-login-owner-link"
            onClick={() => setReload(value => value + 1)}
          >
            重新读取入口状态
          </button>
        )}
        {status?.configured === false && (
          <div className="admin-login-initial-setup">
            <p>尚未设置管理密码。首次配置后，即可使用密码登录。</p>
            {status.runtime === "managed" ? (
              <button
                type="button"
                className="admin-login-owner-link"
                onClick={handleOwnerLogin}
              >
                所有者登录 · 初始化管理密码{" "}
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            ) : (
              <p>请由服务器所有者完成首次管理员密码初始化。</p>
            )}
          </div>
        )}
        <div className="admin-login-footer">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>此入口仅供管理员使用</span>
        </div>
      </section>
      <p className="admin-login-wordmark">
        EXITPANEL <span>/</span> PRIVATE CONTROL
      </p>
    </main>
  );
}

export default AdminLogin;
