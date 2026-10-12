// One bundle drives both windows; `?panel` renders the compact quick list instead.

import { listen } from "@tauri-apps/api/event"
import { BadShortcut, display, fromEvent } from "./keys.ts"
import { type Account, BadLink, fromExport, parse, toLink } from "./otpauth.ts"
import * as store from "./store.ts"
import { code, forget, secondsLeft } from "./totp.ts"

const PANEL = new URLSearchParams(location.search).has("panel")
const REVEAL = 88
const QUICK_ROWS = 9 // 1-9 copy directly, so the panel shows no more than that

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const el = <T extends HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel)

let vault: store.Vault = { accounts: [], settings: { ...store.DEFAULTS } }
let filter = ""
let selected = 0
let editing: Account | null = null
let openRow: HTMLElement | null = null
let swiping = false

const accounts = (): Account[] => {
  const needle = filter.toLowerCase()
  const all = vault.accounts.filter((a) => `${a.issuer} ${a.label}`.toLowerCase().includes(needle))
  return PANEL ? all.slice(0, QUICK_ROWS) : all
}

// ---- chrome ----

let toastTimer: ReturnType<typeof setTimeout> | undefined
const toast = (message: string): void => {
  const node = $("toast")
  node.textContent = message
  node.classList.add("show")
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => node.classList.remove("show"), 1600)
}

const persist = (): void => store.save(vault)

// ---- clipboard ----

let clearTimer: ReturnType<typeof setTimeout> | undefined

const copy = async (account: Account): Promise<void> => {
  const digits = await code(account.secret, account.period, account.digits)
  try {
    await store.copyCode(digits)
  } catch (error) {
    return toast(String(error))
  }
  toast("Copied")

  clearTimeout(clearTimer)
  const seconds = vault.settings.clipboardSeconds
  if (seconds > 0) clearTimer = setTimeout(() => void store.clearCode(digits), seconds * 1000)
  if (PANEL) await store.hidePanel()
}

// ---- list ----

const ICON = {
  edit: '<svg width="15" height="15" viewBox="0 0 15 15"><path d="M10 2.2l2.8 2.8-7.2 7.2-3.4.6.6-3.4L10 2.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  remove: '<svg width="15" height="15" viewBox="0 0 15 15"><path d="M2.8 4.2h9.4M5.8 4.2V2.6h3.4v1.6M4.1 4.2l.6 8.2h5.6l.6-8.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
}

const rowHTML = (a: Account, i: number): string =>
  `<div class="item${PANEL && i === selected ? " sel" : ""}" data-i="${i}"${PANEL ? "" : ' draggable="true"'}>` +
  (PANEL
    ? ""
    : `<div class="swipe"><button class="edit" data-act="edit" title="Rename">${ICON.edit}</button>` +
      `<button class="del" data-act="del" title="Remove">${ICON.remove}</button></div>`) +
  `<div class="face"><div class="mono">${a.issuer.slice(0, 1).toUpperCase() || "?"}</div>` +
  `<div class="meta"><div class="name"></div><div class="sub"></div></div>` +
  `<div class="right"><div class="code" data-code>······</div><div class="ring" data-ring></div></div></div></div>`

const render = (): void => {
  openRow = null
  const list = $(PANEL ? "plist" : "list")
  const items = accounts()
  if (!items.length) {
    list.innerHTML = `<div class="empty">${
      vault.accounts.length ? "Nothing matches" : "No accounts yet<br>Add one with +"
    }</div>`
    return
  }
  list.innerHTML = items.map(rowHTML).join("")
  // issuer and label come from a pasted link, so they go in as text, never as markup
  for (const row of list.querySelectorAll<HTMLElement>(".item")) {
    const a = items[Number(row.dataset.i)]!
    el(".name", row)!.textContent = a.issuer
    el(".sub", row)!.textContent = a.label || "—"
  }
  void tick()
}

const tick = async (): Promise<void> => {
  const list = $(PANEL ? "plist" : "list")
  const items = accounts()
  const now = Date.now()
  for (const row of list.querySelectorAll<HTMLElement>(".item")) {
    const a = items[Number(row.dataset.i)]
    if (!a) continue
    const left = secondsLeft(now, a.period)
    const soon = left < 5
    const face = el(".face", row)!
    const digits = await code(a.secret, a.period, a.digits, now)
    const out = el(".code", row)!
    out.textContent =
      vault.settings.mask && !face.matches(":hover") ? "•".repeat(a.digits) : digits.replace(/(.{3})(?=.)/g, "$1 ")
    out.classList.toggle("soon", soon)
    const ring = el(".ring", row)!
    ring.style.setProperty("--p", (left / a.period).toFixed(3))
    ring.classList.toggle("soon", soon)
  }
}

// ponytail: one redraw a quarter second for the whole list. Fine for tens of rows.
setInterval(() => void tick(), 250)

// ---- swipe left to reveal edit / remove ----

const closeRow = (): void => {
  openRow?.classList.remove("open")
  openRow = null
}
const openAt = (row: HTMLElement): void => {
  if (openRow !== row) closeRow()
  row.classList.add("open")
  openRow = row
}

const installSwipe = (list: HTMLElement): void => {
  let drag: { row: HTMLElement; x: number; y: number; from: number; moved: boolean } | null = null

  list.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("[data-act]")) return
    const row = (e.target as HTMLElement).closest<HTMLElement>(".item")
    if (!row) return
    drag = { row, x: e.clientX, y: e.clientY, from: row.classList.contains("open") ? -REVEAL : 0, moved: false }
  })

  list.addEventListener("pointermove", (e) => {
    if (!drag) return
    const [dx, dy] = [e.clientX - drag.x, e.clientY - drag.y]
    if (!drag.moved) {
      if (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(dy)) return
      drag.moved = swiping = true
      drag.row.classList.add("swiping")
    }
    let x = drag.from + dx
    if (x > 0) x *= 0.25 // ponytail: rubber band past the stops rather than a hard clamp
    if (x < -REVEAL) x = -REVEAL + (x + REVEAL) * 0.25
    el(".face", drag.row)!.style.transform = `translateX(${x}px)`
  })

  window.addEventListener("pointerup", () => {
    if (!drag) return
    if (drag.moved) {
      const face = el(".face", drag.row)!
      const x = new DOMMatrix(getComputedStyle(face).transform).m41
      drag.row.classList.remove("swiping")
      face.style.transform = ""
      if (x < -REVEAL / 2) openAt(drag.row)
      else closeRow()
      setTimeout(() => (swiping = false))
    }
    drag = null
  })

  list.addEventListener(
    "wheel",
    (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".item")
      if (!row || Math.abs(e.deltaX) < 8 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return
      e.preventDefault()
      if (e.deltaX > 0) openAt(row)
      else closeRow()
    },
    { passive: false },
  )
}

// ---- panels ----

const show = (id: "" | "p-add" | "p-set"): void => {
  if (id !== "p-add") editing = null
  for (const panel of document.querySelectorAll<HTMLElement>(".panelview")) panel.classList.toggle("on", panel.id === id)
  $("b-add").classList.toggle("on", id === "p-add")
  $("b-set").classList.toggle("on", id === "p-set")
}

const problem = (id: string, error: unknown): void => {
  const node = $(id)
  node.textContent = error instanceof Error ? error.message : String(error)
  node.style.display = "block"
}

const addForm = (account: Account | null): void => {
  editing = account
  $("add-title").textContent = account ? "Edit account" : "Add account"
  $("uri-add").textContent = account ? "Save" : "Add"
  $("uri-clear").textContent = account ? "Cancel" : "Clear"
  $<HTMLInputElement>("name").value = account?.issuer === "Unknown" ? "" : (account?.issuer ?? "")
  $<HTMLTextAreaElement>("uri-in").value = account?.secret ?? ""
  $("uri-msg").style.display = "none"
  $("qr-msg").style.display = "none"
  show("p-add")
  $(account ? "name" : "uri-in").focus()
}

/**
 * One box, three kinds of paste: a key, a setup link, or an export link. The typed name wins
 * over whatever a link carries, and editing keeps the parts the box cannot show.
 */
const read = (): Account[] => {
  const name = $<HTMLInputElement>("name").value.trim()
  const text = $<HTMLTextAreaElement>("uri-in").value.trim()
  if (text.startsWith("otpauth-migration://")) return fromExport(text)

  const account = parse(text)
  if (name) account.issuer = name
  if (!text.toLowerCase().startsWith("otpauth://") && editing) {
    account.label = editing.label
    account.period = editing.period
    account.digits = editing.digits
  }
  return [account]
}

const addAll = (incoming: Account[]): void => {
  const known = new Set(vault.accounts.map((a) => a.secret))
  const fresh = incoming.filter((a) => !known.has(a.secret))
  vault.accounts.push(...fresh)
  persist()
  render()
  show("")
  toast(fresh.length ? `${fresh.length} added` : "Already have all of those")
}

const commit = (incoming: Account): void => {
  if (editing) {
    if (editing.secret !== incoming.secret) forget(editing.secret)
    Object.assign(editing, incoming)
    toast(`${incoming.issuer} saved`)
  } else {
    vault.accounts.push(incoming)
    toast(`${incoming.issuer} added`)
  }
  persist()
  render()
  show("")
}

// ---- settings ----

const paintClipboard = (): void => {
  const slider = $<HTMLInputElement>("clip")
  slider.style.setProperty("--f", `${(Number(slider.value) / Number(slider.max)) * 100}%`)
  $("clip-note").textContent = slider.value === "0" ? "never" : `after ${slider.value} s`
}

const paintSettings = (): void => {
  const { mask, shortcut, autostart, clipboardSeconds } = vault.settings
  $<HTMLInputElement>("sw-mask").checked = mask
  $<HTMLInputElement>("sw-login").checked = autostart
  $("rec").textContent = display(shortcut)
  $<HTMLInputElement>("clip").value = String(clipboardSeconds)
  paintClipboard()
}

const recordShortcut = (): void => {
  const chip = $("rec")
  const note = $("rec-note")
  chip.classList.add("rec")
  chip.textContent = "press keys"
  note.textContent = "Listening…"

  const done = async (e: KeyboardEvent): Promise<void> => {
    e.preventDefault()
    let accelerator: string
    try {
      accelerator = fromEvent(e)
    } catch (error) {
      // a modifier on its own: keep listening
      if (error instanceof BadShortcut && error.message.startsWith("Hold the")) return
      chip.classList.remove("rec")
      chip.textContent = display(vault.settings.shortcut)
      note.textContent = error instanceof Error ? error.message : String(error)
      window.removeEventListener("keydown", done, true)
      return
    }
    window.removeEventListener("keydown", done, true)
    chip.classList.remove("rec")
    try {
      await store.setShortcut(accelerator)
      vault.settings.shortcut = accelerator
      persist()
      note.textContent = "Summon the list anywhere"
    } catch (error) {
      note.textContent = String(error)
    }
    chip.textContent = display(vault.settings.shortcut)
  }
  window.addEventListener("keydown", done, true)
}

// ---- main window wiring ----

const installCard = (): void => {
  const list = $("list")
  installSwipe(list)

  $<HTMLInputElement>("q").oninput = (e) => {
    filter = (e.target as HTMLInputElement).value.trim()
    selected = 0
    render()
  }

  list.onclick = (e) => {
    const target = e.target as HTMLElement
    const row = target.closest<HTMLElement>(".item")
    if (!row) return
    const account = accounts()[Number(row.dataset.i)]
    if (!account) return
    const act = target.closest<HTMLElement>("[data-act]")?.dataset.act
    if (act === "del") {
      closeRow()
      vault.accounts = vault.accounts.filter((a) => a !== account)
      forget(account.secret)
      persist()
      render()
      toast(`${account.issuer} removed`)
      return
    }
    if (act === "edit") {
      closeRow()
      addForm(account)
      return
    }
    if (swiping) return
    if (row === openRow) return closeRow()
    void copy(account)
  }

  // drag to reorder; a swipe or an open row is not a reorder
  let dragged: HTMLElement | null = null
  list.addEventListener("dragstart", (e) => {
    if (swiping || openRow) return e.preventDefault()
    dragged = (e.target as HTMLElement).closest<HTMLElement>(".item")
    dragged?.classList.add("drag")
  })
  list.addEventListener("dragover", (e) => {
    e.preventDefault()
    const row = (e.target as HTMLElement).closest<HTMLElement>(".item")
    if (!row || row === dragged) return
    for (const other of list.querySelectorAll(".over")) other.classList.remove("over")
    row.classList.add("over")
  })
  list.addEventListener("drop", (e) => {
    e.preventDefault()
    const row = (e.target as HTMLElement).closest<HTMLElement>(".item")
    if (!row || !dragged) return
    const shown = accounts()
    const [from, to] = [shown[Number(dragged.dataset.i)]!, shown[Number(row.dataset.i)]!]
    const list2 = vault.accounts
    list2.splice(list2.indexOf(to), 0, ...list2.splice(list2.indexOf(from), 1))
    persist()
    render()
  })
  list.addEventListener("dragend", () => {
    dragged = null
    render()
  })

  $("b-add").onclick = () => ($("p-add").classList.contains("on") ? show("") : addForm(null))
  $("b-set").onclick = () => ($("p-set").classList.contains("on") ? show("") : show("p-set"))

  $("uri-clear").onclick = () => {
    if (editing) return show("")
    $<HTMLInputElement>("name").value = ""
    $<HTMLTextAreaElement>("uri-in").value = ""
    $("uri-msg").style.display = "none"
  }
  $("uri-add").onclick = () => {
    $("uri-msg").style.display = "none"
    try {
      const incoming = read()
      if (incoming.length === 1) commit(incoming[0]!)
      else addAll(incoming)
    } catch (error) {
      problem("uri-msg", error)
    }
  }

  // ---- QR: decode a dropped or pasted image ----
  const fromImage = async (blob: Blob, msg = "qr-msg"): Promise<void> => {
    $(msg).style.display = "none"
    try {
      const found = await store.scanQR(new Uint8Array(await blob.arrayBuffer()))
      if (!found) throw new BadLink("No QR code in that image.")
      if (found.startsWith("otpauth-migration://")) return addAll(fromExport(found))
      commit(parse(found))
    } catch (error) {
      problem(msg, error)
    }
  }

  $<HTMLInputElement>("file").onchange = (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) void fromImage(file)
  }

  const drop = $("drop")
  for (const name of ["dragover", "dragenter"])
    drop.addEventListener(name, (e) => {
      e.preventDefault()
      drop.classList.add("hot")
    })
  for (const name of ["dragleave", "drop"])
    drop.addEventListener(name, (e) => {
      e.preventDefault()
      drop.classList.remove("hot")
    })
  drop.addEventListener("drop", (e) => {
    const file = (e as DragEvent).dataTransfer?.files[0]
    if (file) void fromImage(file)
  })
  drop.onclick = () => $("file").click()

  // a screenshot pasted into the link box is a QR, not text
  $("uri-in").addEventListener("paste", (e) => {
    const image = [...((e as ClipboardEvent).clipboardData?.items ?? [])]
      .find((i) => i.type.startsWith("image/"))
      ?.getAsFile()
    if (!image) return
    e.preventDefault()
    void fromImage(image, "uri-msg")
  })

  // ---- settings ----
  $<HTMLInputElement>("sw-mask").onchange = (e) => {
    vault.settings.mask = (e.target as HTMLInputElement).checked
    persist()
    void tick()
  }
  $<HTMLInputElement>("sw-login").onchange = async (e) => {
    const on = (e.target as HTMLInputElement).checked
    try {
      await store.setAutostart(on)
      vault.settings.autostart = on
      persist()
    } catch (error) {
      ;(e.target as HTMLInputElement).checked = !on
      toast(String(error))
    }
  }
  const slider = $<HTMLInputElement>("clip")
  slider.oninput = () => {
    vault.settings.clipboardSeconds = Number(slider.value)
    paintClipboard()
    persist()
  }
  $("rec").onclick = recordShortcut
  $("export").onclick = async () => {
    if (!vault.accounts.length) return toast("Nothing to export")
    if (!confirm("Write every key, unencrypted, to a file in Downloads?")) return
    try {
      toast(`Saved to ${await store.exportLinks(vault.accounts.map(toLink).join("\n") + "\n")}`)
    } catch (error) {
      toast(String(error))
    }
  }

  window.addEventListener("keydown", (e) => {
    if ($("rec").classList.contains("rec")) return
    const typing = /INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)
    if (e.key === "/" && !typing) {
      e.preventDefault()
      show("")
      $("q").focus()
    }
    if (e.key === "Escape") {
      closeRow()
      show("")
      $<HTMLInputElement>("q").value = ""
      filter = ""
      render()
      ;(e.target as HTMLElement).blur?.()
    }
  })
}

// ---- quick panel wiring ----

const installPanel = (): void => {
  document.body.classList.add("panel")

  window.addEventListener("keydown", (e) => {
    const shown = accounts()
    if (e.key === "Escape") return void store.hidePanel()
    if (e.key === "ArrowDown") {
      selected = Math.min(selected + 1, shown.length - 1)
      render()
    }
    if (e.key === "ArrowUp") {
      selected = Math.max(selected - 1, 0)
      render()
    }
    if (e.key === "Enter" && shown[selected]) void copy(shown[selected]!)
    if (/^[1-9]$/.test(e.key) && shown[Number(e.key) - 1]) void copy(shown[Number(e.key) - 1]!)
  })

  $("plist").onclick = (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".item")
    const account = row && accounts()[Number(row.dataset.i)]
    if (account) void copy(account)
  }

  void listen("panel-shown", async () => {
    vault = await store.load()
    selected = 0
    render()
  })
}

// ---- start ----

const start = async (): Promise<void> => {
  try {
    vault = await store.load()
  } catch (error) {
    toast(`Could not read the vault: ${error instanceof Error ? error.message : String(error)}`)
    return // leave the list empty rather than overwrite a vault we failed to parse
  }
  if (PANEL) installPanel()
  else {
    installCard()
    paintSettings()
  }
  render()
  if (!PANEL) void store.setShortcut(vault.settings.shortcut).catch(() => toast("That shortcut could not be registered"))
}

void start()
