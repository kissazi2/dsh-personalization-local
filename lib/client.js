// dsh-personalization-local · client half（浏览器侧）— dsh 0.2.0-rc.2 兼容
// 向「设置」页 settings.section 插槽注册「个性化」分区：
// 关于你（称呼/职业/补充介绍）+ Chat 回复偏好（下拉），
// 保存后写入本插件条目自己的 settings 命名空间（describe / update RPC），
// 宿主条目带新配置重载，下个新对话即注入个性化系统提示词。
window.__ModuleLoader__.load({
  id: "dsh-personalization-local",
  factory: (require) => {
    var React = require("react")

    // 设置命名空间 = 本插件条目 id（实际条目 id 可能带 include: 前缀，用后缀匹配）。
    const ENTRY_SUFFIX = "personalization"

    const FIELDS = {
      detailLevel: {
        label: "详细程度",
        options: ["简洁", "适中", "深入"],
      },
      emoji: {
        label: "表情符号",
        options: ["关闭", "减弱", "正常", "丰富"],
      },
      tone: {
        label: "语气风格",
        options: ["专业顾问", "轻松友好", "吐槽达人", "简洁直接"],
      },
      answerStructure: {
        label: "回答结构",
        options: ["结论先行", "逐步展开", "总分总", "列表优先"],
      },
    }
    const PREF_KEYS = Object.keys(FIELDS)

    function namespacesOf(value) {
      if (Array.isArray(value)) return value
      return Array.isArray(value?.namespaces) ? value.namespaces : []
    }

    async function loadRow(ctx) {
      const response = await ctx.remote.settings.describe()
      if (response && typeof response === "object" && "ok" in response && !response.ok) {
        throw new Error(response?.error?.message || "settings.describe 失败")
      }
      const rows = namespacesOf(response?.value ?? response)
      return rows.find((row) => typeof row?.ns === "string" && row.ns.endsWith(ENTRY_SUFFIX)) ?? null
    }

    async function savePatch(ctx, ns, revision, patch) {
      const response = await ctx.remote.settings.update(ns, patch, revision)
      if (response && typeof response === "object" && "ok" in response && !response.ok) {
        throw new Error(response?.error?.message || "settings.update 失败")
      }
      return response?.value ?? response
    }

    // ---------- 基础控件 ----------
    const inputStyle = {
      width: "100%",
      padding: "10px 12px",
      borderRadius: "10px",
      border: "1px solid rgba(128,128,128,0.28)",
      background: "transparent",
      color: "inherit",
      fontSize: "13px",
      lineHeight: "1.5",
      fontFamily: "inherit",
      boxSizing: "border-box",
      outline: "none",
    }
    const cardStyle = {
      border: "1px solid rgba(128,128,128,0.22)",
      borderRadius: "12px",
      padding: "20px",
      marginBottom: "20px",
      background: "transparent",
    }
    const headingStyle = {
      fontSize: "13px",
      fontWeight: 600,
      margin: "0 0 14px",
      color: "inherit",
    }
    const labelStyle = {
      display: "block",
      fontSize: "12px",
      margin: "0 0 6px",
      opacity: 0.85,
    }

    function TextField(props) {
      return React.createElement(
        "div",
        { style: { marginBottom: "16px" } },
        React.createElement("label", { style: labelStyle }, props.label),
        React.createElement("input", {
          type: "text",
          value: props.value,
          placeholder: props.placeholder,
          onChange: (e) => props.onChange(e.target.value),
          style: inputStyle,
        }),
      )
    }

    function SelectField(props) {
      return React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "12px 0",
            borderBottom: "1px solid rgba(128,128,128,0.15)",
          },
        },
        React.createElement("span", { style: { fontSize: "13px" } }, props.label),
        React.createElement(
          "select",
          {
            value: props.value,
            onChange: (e) => props.onChange(e.target.value),
            style: { ...inputStyle, width: "180px", cursor: "pointer", padding: "8px 10px" },
          },
          props.options.map((opt) =>
            React.createElement("option", { key: opt, value: opt }, opt),
          ),
        ),
      )
    }

    // ---------- 「个性化」分区组件（props 由设置外壳传入 {close}） ----------
    function PersonalizationSection(props) {
      const [status, setStatus] = React.useState("loading")
      const [error, setError] = React.useState(null)
      const [savedAt, setSavedAt] = React.useState(0)
      const [busy, setBusy] = React.useState(false)
      const [row, setRow] = React.useState(null)
      const [form, setForm] = React.useState({
        enabled: true,
        nickname: "",
        occupation: "",
        about: "",
        detailLevel: "深入",
        emoji: "减弱",
        tone: "吐槽达人",
        answerStructure: "结论先行",
      })

      const refresh = React.useCallback(async () => {
        try {
          const next = await loadRow(props.__ctx)
          setRow(next)
          if (!next) {
            setError("未找到本插件的配置条目（settings.describe 未返回 personalization 命名空间），无法保存")
          }
          const value = next?.value ?? {}
          setForm((prev) => ({
            ...prev,
            enabled: value.enabled !== false,
            nickname: typeof value.nickname === "string" ? value.nickname : "",
            occupation: typeof value.occupation === "string" ? value.occupation : "",
            about: typeof value.about === "string" ? value.about : "",
            detailLevel: typeof value.detailLevel === "string" && value.detailLevel ? value.detailLevel : prev.detailLevel,
            emoji: typeof value.emoji === "string" && value.emoji ? value.emoji : prev.emoji,
            tone: typeof value.tone === "string" && value.tone ? value.tone : prev.tone,
            answerStructure:
              typeof value.answerStructure === "string" && value.answerStructure
                ? value.answerStructure
                : prev.answerStructure,
          }))
          setStatus("ready")
          if (next) setError(null)
        } catch (e) {
          setStatus("error")
          setError(e instanceof Error ? e.message : String(e))
        }
      }, [])

      React.useEffect(() => { void refresh() }, [refresh])

      const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }))

      const save = async () => {
        let target = row
        if (!target) {
          // 二次尝试：describe 里没匹配到时重拉一次，仍没有就明确报错而不是静默返回
          setBusy(true)
          try {
            target = await loadRow(props.__ctx)
            setRow(target)
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(false)
          }
          if (!target) {
            setError("保存失败：未找到本插件的配置条目（ns 后缀 personalization）。请把这段提示发给开发者排查。")
            return
          }
        }
        setBusy(true)
        try {
          const view = await savePatch(props.__ctx, target.ns, target.revision, form)
          setRow({
            ...target,
            revision: view?.revision ?? target.revision,
            value: { ...(target.value ?? {}), ...form },
          })
          setSavedAt(Date.now())
          setError(null)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          setBusy(false)
        }
      }

      if (status === "loading") {
        return React.createElement("div", { style: { padding: "24px", fontSize: "13px", opacity: 0.7 } }, "加载个性化设置…")
      }

      return React.createElement(
        "div",
        {
          style: {
            height: "100%",
            overflowY: "auto",
            padding: "4px 24px 24px",
            boxSizing: "border-box",
            fontSize: "13px",
          },
        },
        React.createElement("h2", { style: { fontSize: "15px", margin: "8px 0 16px" } }, "个性化"),
        error ? React.createElement("div", { style: { color: "#d64545", fontSize: "12px", marginBottom: "12px" } }, error) : null,

        // ---- 关于你 ----
        React.createElement(
          "div",
          { style: cardStyle },
          React.createElement("h3", { style: headingStyle }, "关于你"),
          React.createElement(TextField, {
            label: "我应该怎么称呼你？",
            value: form.nickname,
            placeholder: "例如：老板",
            onChange: set("nickname"),
          }),
          React.createElement(TextField, {
            label: "你的职业 / 角色是？",
            value: form.occupation,
            placeholder: "例如：架构师/技术团队负责人",
            onChange: set("occupation"),
          }),
          React.createElement(
            "div",
            null,
            React.createElement("label", { style: labelStyle }, "还有什么想让我了解的？"),
            React.createElement("textarea", {
              value: form.about,
              placeholder: "你的兴趣偏好、常用场景、回答风格，或任何希望被了解的信息",
              onChange: (e) => set("about")(e.target.value),
              style: { ...inputStyle, minHeight: "120px", resize: "vertical" },
            }),
          ),
        ),

        // ---- Chat 回复偏好 ----
        React.createElement(
          "div",
          { style: cardStyle },
          React.createElement("h3", { style: headingStyle }, "Chat 回复偏好"),
          PREF_KEYS.map((key, index) =>
            React.createElement(SelectField, {
              key,
              label: FIELDS[key].label,
              options: FIELDS[key].options,
              value: form[key],
              onChange: set(key),
              last: index === PREF_KEYS.length - 1,
            }),
          ),
        ),

        // ---- 保存 ----
        React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "12px" } },
          savedAt && !busy
            ? React.createElement("span", { style: { fontSize: "12px", opacity: 0.6 } }, "已保存，对下个新对话生效")
            : null,
          row
            ? React.createElement("span", { style: { fontSize: "11px", opacity: 0.4 } }, `ns=${row.ns} rev=${row.revision}`)
            : null,
          React.createElement(
            "button",
            {
              type: "button",
              onClick: save,
              disabled: busy || status !== "ready",
              style: {
                padding: "8px 20px",
                borderRadius: "10px",
                border: "1px solid rgba(90,140,255,0.5)",
                background: busy ? "rgba(90,140,255,0.35)" : "rgba(90,140,255,0.16)",
                color: "inherit",
                fontSize: "13px",
                cursor: busy ? "default" : "pointer",
              },
            },
            busy ? "保存中…" : "保存设置",
          ),
        ),
      )
    }

    function apply(ctx) {
      ctx.slots.inject("settings.section", () => ctx.slots.register(
        {
          name: "settings.section",
          id: "personalization",
          order: 5,
          label: "个性化",
        },
        // 给组件带上 ctx，便于表单内部做 settings RPC
        (slotProps) => React.createElement(PersonalizationSection, { ...slotProps, __ctx: ctx }),
      ))
    }

    // Cordis 对嵌套服务属性访问做 inject 校验：ctx.remote.settings 需要
    // 同时声明 "remote" 与 "remote.settings"（缺一即抛 without inject）。
    const inject = ["slots", "remote", "remote.settings"]
    return { inject, apply }
  },
})
