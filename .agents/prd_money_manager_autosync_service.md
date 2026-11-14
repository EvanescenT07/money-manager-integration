# Product Requirements Document (PRD): Money Manager AI AutoSync & Telemetry Service

| Metadata Dokumen | Detail Spesifikasi |
| :--- | :--- |
| **Nama Produk** | **MM-AutoSync Engine & Telemetry Dashboard** |
| **Versi Dokumen** | `v2.0` (Cakupan Data: `2022-01-01` s/d `2026-11-30`) |
| **Target Aplikasi** | Money Manager by Realbyte (Android — *Offline-First*) |
| **Platform Deployment** | Vercel (*Fluid Compute / Edge Runtime*) |
| **Tech Stack Utama** | TypeScript $5.x$, Next.js (App Router) + Hono RPC, Zod, `@google/genai` (`gemini-2.5-flash`), Upstash Redis |
| **Integrasi Perangkat** | MacroDroid (*Notification Listener* $\rightarrow$ *Serverless AI* $\rightarrow$ *Webhook UI Automation*) |

---

## 1. Latar Belakang & Tujuan Produk

Aplikasi **Money Manager (Realbyte)** menyimpan basis data secara lokal di perangkat Android tanpa menyediakan Cloud API publik. Berdasarkan histori transaksi pengguna periode **Januari 2022 – November 2026**, aktivitas pencatatan didominasi oleh transaksi harian berfrekuensi tinggi (makanan/minuman, kopi, transportasi umum, minimarket, tagihan rutin, hingga mutasi *e-wallet*, *cashback*, dan investasi).

Layanan **MM-AutoSync Engine** dirancang untuk menghilangkan $100\%$ kebutuhan input manual maupun *import* file Excel (`.xls`/`.xlsx`) dengan alur otomatis dari hulu ke hilir:

1. **Zero-Touch Notification Capture:** Menyadap seluruh notifikasi transaksi keluar (`Expense`), uang masuk (`Income`), *split bill* teman, dividen saham, dan *cashback* dari berbagai aplikasi Bank serta *E-Wallet* menggunakan MacroDroid.
2. **Multimodal Telegram Bot:** Menerima input teks bahasa bebas (*natural language*) dan foto struk belanja/bukti transfer (*OCR*) melalui Telegram.
3. **Strict Enum & Hierarchy Enforcement:** Memvalidasi hasil ekstraksi AI agar $100\%$ sesuai (*case-sensitive* & *typo-preserved*) dengan daftar `Account`, `Category`, dan `Subcategory` pada aplikasi Money Manager pengguna.
4. **Automated UI Injection (Metode B):** Mengirimkan instruksi terstruktur kembali ke MacroDroid melalui *Webhook* untuk diisikan langsung ke antarmuka aplikasi Money Manager saat layar perangkat tidak terkunci.
5. **Web UI Dashboard (Logs & HealthCheck):** Menyediakan antarmuka web *real-time* untuk memantau kesehatan sistem (*HealthCheck*), melihat log ekstraksi AI, serta melakukan *One-Click Retry* apabila perangkat sempat terputus dari jaringan.

---

## 2. Arsitektur & Rekomendasi Tech Stack Optimal di Vercel

Untuk mendapatkan *cold-start* minimal ($< 50\text{ ms}$), *type-safety* menyeluruh dari *backend* ke *frontend*, serta efisiensi kuota pada *Vercel Free/Pro Tier*, sistem menggunakan arsitektur monorepo berbasis **Next.js App Router + Hono**:

| Layer | Teknologi Pilihan | Alasan Teknis & Optimasi Performa di Vercel |
| :--- | :--- | :--- |
| **API Router (Backend)** | **Hono** (`src/app/api/[[...route]]/route.ts`) | Dibangun di atas Web Standard API (`Request`/`Response`), ukuran *bundle* sangat ringan ($\approx 14\text{ KB}$), mendukung *Vercel Fluid Compute* & *Edge Runtime*, serta memiliki fitur **Hono RPC** untuk berbagi tipe data langsung dengan UI Next.js. |
| **UI Layer (Frontend)** | **Next.js (App Router) + Tailwind CSS + shadcn/ui** | Menggunakan *React Server Components (RSC)* dan *SWR* untuk menampilkan halaman **Live Log & HealthCheck** dengan beban *client-side JavaScript* yang sangat kecil. |
| **Schema & Validation** | **Zod** + `@hono/zod-validator` | Menjamin validasi struktur data saat *runtime* dan mengunci kombinasi hirarki `Type` $\rightarrow$ `Category` $\rightarrow$ `Subcategory` sebelum dikirim ke MacroDroid. |
| **AI & OCR Engine** | **`@google/genai` (`gemini-2.5-flash`)** | Mendukung fitur *Structured Outputs* (`responseSchema`) yang memaksa model hanya mengeluarkan nilai `Enum` yang terdaftar, serta mendukung pembacaan foto struk (*Multimodal Vision*) dalam waktu $\approx 0.8\text{ s} - 1.5\text{ s}$. |
| **State & Log Storage** | **Upstash Redis** *(Serverless HTTP Redis)* | Karena *Vercel Serverless Function* bersifat *stateless*, Upstash Redis digunakan untuk menyimpan daftar log transaksi terbaru ($100\text{--}500$ log terakhir dengan *auto-trim*), metrik *latency*, dan status *heartbeat* perangkat dengan *latency* $< 5\text{ ms}$. |

---

## 3. Kamus Data & Spesifikasi Lengkap TypeScript `Enum`

Seluruh definisi di bawah ini mencakup akun aktif maupun historis beserta aturan khusus pada basis data Money Manager Anda:

* **Preservasi Ejaan Spesifik (*Typo-Preserved*):**
  * Kategori hiburan wajib dieja **`Entertaiment`** (tanpa huruf *'n'* di tengah).
  * Kategori pengembangan diri wajib dieja **`Self-development`** (huruf *'d'* kecil dengan tanda hubung).
  * Kategori kas kecil dieja **`Petty cash`** (huruf *'c'* kecil).
  * Subkategori belanja daring dieja **`e-Commerce`**.
* **Pemisahan Konteks `Investment` & `Other`:**
  * Pada transaksi **`Income`** (dividen atau pencairan RDN), **`Investment`** adalah **`Category`** dengan **`Subcategory: "Stockbit"`**.
  * Pada transaksi **`Expense`** (beli saham/reksa dana), **`Investment`** adalah **`Subcategory`** di bawah **`Category: "Self-development"`**.
  * Pada transaksi **`Income`**, *cashback* masuk ke **`Category: "Other"`** $\rightarrow$ **`Subcategory: "Cashback"`**.

### Snippet Kode: `src/types/enums.ts`

```typescript
import { z } from "zod";
import { Type, Schema } from "@google/genai";

// ============================================================================
// 1. TRANSACTION TYPE & CURRENCY ENUMS
// ============================================================================
export const TransactionTypeEnum = z.enum(["Expense", "Income"]);
export type TransactionType = z.infer<typeof TransactionTypeEnum>;

export const CurrencyEnum = z.enum(["IDR"]);

// ============================================================================
// 2. ACCOUNT ENUMS (2022-01-01 s/d 2026-11-30)
// ============================================================================
export const ActiveAccountEnum = z.enum([
  "Jago",             // Bank Jago / QRIS Jago (Utama)
  "Cash",             // Tunai
  "Shopeepay",        // ShopeePay
  "Gopay",            // GoPay / Gojek
  "Blu",              // blu by BCA Digital
  "Mandiri",          // Livin' by Mandiri
  "BCA",              // BCA mobile / myBCA
  "Rdn Stockbit",     // RDN Stockbit (Investasi & Dividen)
  "Jago - Paylater",  // Tagihan ShopeePayLater / GoPayLater
  "Other"             // Akun Lainnya
]);

export const LegacyAccountEnum = z.enum([
  "Accounts",         // Akun gabungan historis (2022-2025)
  "Card"              // Kartu historis (2022)
]);

export const AllAccountEnum = z.enum([
  ...ActiveAccountEnum.options,
  ...LegacyAccountEnum.options
]);
export type AccountName = z.infer<typeof AllAccountEnum>;

// ============================================================================
// 3. CATEGORY ENUMS (EXPENSE & INCOME)
// ============================================================================
export const ExpenseCategoryEnum = z.enum([
  "Food",
  "Transportation",
  "Social Life",
  "Self Need",
  "Other",
  "Self-development", // Case-sensitive ('d' kecil)
  "Apparel",
  "Paylater",
  "Entertaiment",     // Typo-preserved (tanpa 'n' di tengah)
  "Beauty",
  "Health",
  "Work Need",
  "Education",
  "Shopping",
  "Gift"
]);

export const IncomeCategoryEnum = z.enum([
  "Other",
  "Investment",
  "Social",
  "Allowance",
  "THR",
  "Salary",
  "Part Time",
  "Bonus",
  "Petty cash"        // Case-sensitive ('c' kecil)
]);

export const AllCategoryEnum = z.enum([
  "Food",
  "Transportation",
  "Social Life",
  "Self Need",
  "Other",
  "Self-development",
  "Apparel",
  "Paylater",
  "Entertaiment",
  "Beauty",
  "Health",
  "Work Need",
  "Education",
  "Shopping",
  "Gift",
  "Investment",
  "Social",
  "Allowance",
  "THR",
  "Salary",
  "Part Time",
  "Bonus",
  "Petty cash"
]);
export type CategoryName = z.infer<typeof AllCategoryEnum>;

// ============================================================================
// 4. SUBCATEGORY ENUM (LENGKAP 45 SUBKATEGORI + EMPTY STRING)
// ============================================================================
export const SubcategoryEnum = z.enum([
  "", // Digunakan jika kategori tidak memiliki subkategori
  // Food
  "Daily",
  "Jajan",
  "Coffee",
  "Nongkrong",
  "Date FnB",
  // Transportation
  "Transport Umum",
  "Bensin",
  "Bengkel",
  "Parkir",
  "Automotive Part",
  // Self Need
  "Internet",
  "Self Need",
  "Fragrance",
  "Electronic",
  "Skin Care",
  // Entertaiment
  "Top Up",
  "Movie",
  "Warnet",
  "Billiard",
  "TimeZone",
  "Apps",
  "Music",
  // Self-development (Expense)
  "Investment",
  "Book",
  // Apparel
  "Laundry",
  "Shoes",
  "Clothing",
  // Social Life
  "Friend",
  "Hangout",
  "Alumni",
  // Health
  "Medicine",
  "Health",
  // Other (Expense)
  "Mama",
  "Rumah",
  "Feesible",
  // Shopping
  "Shopee",
  "e-Commerce",
  // Work Need
  "Outing",
  // Allowance (Income)
  "SMBC",
  "AMFS",
  "BSI",
  "Monthly Allowance",
  // Investment (Income)
  "Stockbit",
  // Other (Income)
  "Cashback",
  "Other"
]);
export type SubcategoryName = z.infer<typeof SubcategoryEnum>;

// ============================================================================
// 5. STRICT HIERARCHY MAP & VALIDATOR HELPER
// ============================================================================
export const VALID_HIERARCHY: Record<TransactionType, Record<string, SubcategoryName[]>> = {
  Expense: {
    "Food": ["Daily", "Jajan", "Coffee", "Nongkrong", "Date FnB", ""],
    "Transportation": ["Transport Umum", "Bensin", "Bengkel", "Parkir", "Automotive Part", ""],
    "Social Life": ["Friend", "Hangout", "Alumni", ""],
    "Self Need": ["Internet", "Self Need", "Fragrance", "Electronic", "Skin Care", ""],
    "Other": ["Mama", "Rumah", "Feesible", ""],
    "Self-development": ["Investment", "Book", ""],
    "Apparel": ["Laundry", "Shoes", "Clothing", ""],
    "Paylater": [""],
    "Entertaiment": ["Top Up", "Movie", "Warnet", "Billiard", "TimeZone", "Apps", "Music", ""],
    "Beauty": [""],
    "Health": ["Medicine", "Health", ""],
    "Work Need": ["Outing", ""],
    "Education": [""],
    "Shopping": ["Shopee", "e-Commerce", ""],
    "Gift": [""]
  },
  Income: {
    "Other": ["Cashback", "Other", ""],
    "Investment": ["Stockbit", ""],
    "Social": [""],
    "Allowance": ["SMBC", "AMFS", "BSI", "Monthly Allowance", ""],
    "THR": [""],
    "Salary": [""],
    "Part Time": [""],
    "Bonus": [""],
    "Petty cash": [""]
  }
};

/**
 * Memastikan pasangan Type -> Category -> Subcategory selalu valid
 * sebelum dikirimkan ke MacroDroid UI Automation.
 */
export function sanitizeHierarchy(
  type: TransactionType,
  category: CategoryName,
  subcategory: SubcategoryName
): { category: CategoryName; subcategory: SubcategoryName } {
  const allowedCategories = VALID_HIERARCHY[type];
  const validCategory: CategoryName = allowedCategories[category] ? category : "Other";
  const allowedSubcategories = allowedCategories[validCategory] || [""];
  const validSubcategory: SubcategoryName = allowedSubcategories.includes(subcategory)
    ? subcategory
    : "";

  return { category: validCategory, subcategory: validSubcategory };
}

// ============================================================================
// 6. GEMINI STRUCTURED OUTPUT SCHEMA (@google/genai)
// ============================================================================
export const GeminiResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    ignore: {
      type: Type.BOOLEAN,
      description: "Set true jika input adalah notifikasi promo, iklan, OTP, login, atau bukan transaksi uang."
    },
    reason: {
      type: Type.STRING,
      description: "Alasan singkat jika ignore=true, atau ringkasan ekstraksi."
    },
    transactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: [...TransactionTypeEnum.options] },
          account: { type: Type.STRING, enum: [...ActiveAccountEnum.options] },
          category: { type: Type.STRING, enum: [...AllCategoryEnum.options] },
          subcategory: { type: Type.STRING, enum: [...SubcategoryEnum.options] },
          amount: { type: Type.NUMBER, description: "Nominal transaksi dalam angka bulat positif (IDR)." },
          note: { type: Type.STRING, description: "Catatan singkat huruf kecil sesuai pola user, misal: kopi kenangan, transjakarta, dari yudhis." },
          description: { type: Type.STRING, description: "Detail tambahan jika ada, atau string kosong." }
        },
        required: ["type", "account", "category", "subcategory", "amount", "note", "description"]
      }
    }
  },
  required: ["ignore", "transactions"]
};
```

---

## 4. Aturan Pemetaan Aplikasi Bank & E-Wallet (MacroDroid)

MacroDroid mengirimkan `app_package`, `app_name`, `title`, dan `text` ke endpoint Vercel. AI menggunakan tabel pemetaan berikut untuk menentukan `Account` dan `Category`:

| Nama Aplikasi | Package Name Android | Default `Account` | Aturan Pemetaan Khusus (Expense / Income / Cashback) |
| :--- | :--- | :--- | :--- |
| **Bank Jago** | `com.jago.digitalBanking` | `Jago` | • Bayar QRIS/Transfer keluar $\rightarrow$ `Expense`<br>• Uang masuk dari teman $\rightarrow$ `Income` (`Social`)<br>• Bunga kantong $\rightarrow$ `Income` (`Other` $\rightarrow$ `Other`) |
| **blu by BCA Digital** | `id.co.bcadigital.blu` | `Blu` | • Transaksi QRIS/Debit $\rightarrow$ `Expense`<br>• Cashback blu $\rightarrow$ `Income` (`Other` $\rightarrow$ `Cashback`) |
| **Shopee / ShopeePay** | `com.shopee.id` | `Shopeepay` | • Pembayaran merchant/QRIS $\rightarrow$ `Expense`<br>• Cashback Koin/Saldo $\rightarrow$ `Income` (`Other` $\rightarrow$ `Cashback`)<br>• Tagihan SPayLater $\rightarrow$ Akun `Jago - Paylater`, Kategori `Paylater` |
| **Gojek / GoPay** | `com.gojek.app` / `com.gojek.gopay` | `Gopay` | • GoRide/GoCar/GoPay QRIS $\rightarrow$ `Expense`<br>• Transfer GoPay masuk dari teman $\rightarrow$ `Income` (`Social`) |
| **Livin' by Mandiri** | `id.bmri.livin` | `Mandiri` | • Payroll / Gaji / Allowance AMFS $\rightarrow$ `Income` (`Salary` atau `Allowance` $\rightarrow$ `AMFS`)<br>• QRIS/Transfer keluar $\rightarrow$ `Expense` |
| **BCA mobile / myBCA** | `com.bca` / `com.bca.mybca.omni.android` | `BCA` | • Mutasi keluar $\rightarrow$ `Expense`<br>• Mutasi masuk $\rightarrow$ `Income` |
| **Stockbit** | `com.stockbit.android` | `Rdn Stockbit` | • Dividen tunai / pencairan $\rightarrow$ `Income` (`Investment` $\rightarrow$ `Stockbit`)<br>• Beli saham / IPO $\rightarrow$ `Expense` (`Self-development` $\rightarrow$ `Investment`) |

---

## 5. Spesifikasi Backend API (Hono di Next.js App Router)

Seluruh *endpoint* ditempatkan pada `src/app/api/[[...route]]/route.ts`.

### 5.1. Skema Data Log & HealthCheck (Upstash Redis)

```typescript
export interface TransactionLogItem {
  id: string;                    // UUID / ULID
  timestamp: string;             // ISO-8601 (Asia/Jakarta)
  source: "MACRODROID" | "TELEGRAM_TEXT" | "TELEGRAM_OCR";
  appName?: string;              // Contoh: "Jago", "Shopee"
  rawInput: string;              // Teks asli notifikasi atau chat
  status: "RECORDED" | "SENT_TO_PHONE" | "IGNORED_PROMO" | "FAILED";
  latencyMs: number;             // Waktu pemrosesan Gemini AI + Webhook (ms)
  parsedData?: {
    type: "Expense" | "Income";
    account: string;
    category: string;
    subcategory: string;
    amount: number;
    note: string;
  };
  errorMessage?: string;
}
```

### 5.2. Daftar Endpoint Hono

1. **`POST /api/webhook/macrodroid`**
   * **Fungsi:** Menerima JSON notifikasi dari MacroDroid, memanggil `gemini-2.5-flash`, melakukan sanitasi hirarki dengan `sanitizeHierarchy()`, menyimpan log ke Upstash Redis, menembak *Webhook* MacroDroid #2 (`input_mm`), dan mengirim notifikasi laporan ke Telegram.
2. **`POST /api/webhook/telegram`**
   * **Fungsi:** Menerima pesan teks bebas, foto struk belanja (diubah ke `base64` untuk OCR Gemini Vision), serta menangani penekanan tombol *Inline Keyboard* **`[🔄 Input Ulang ke HP]`** (`callback_query`).
3. **`POST /api/webhook/ack`**
   * **Fungsi:** Dipanggil oleh MacroDroid pada baris aksi terakhir setelah tombol `Save` di aplikasi Money Manager berhasil diklik, untuk memperbarui status log di Redis dari `SENT_TO_PHONE` menjadi `RECORDED`.
4. **`GET /api/health`**
   * **Fungsi:** Mengukur dan mengembalikan kesehatan seluruh komponen:
     * Status koneksi & *latency* **Upstash Redis** (dalam $\text{ms}$).
     * Status kuota & kesiapan **Gemini API**.
     * Status **Telegram Webhook** (`pending_update_count`).
     * Timestamp terakhir kali perangkat Android menghubungi server (*Last Device Heartbeat*).
5. **`GET /api/logs` & `POST /api/logs/:id/retry`**
   * **Fungsi:** Mengambil $100$ log terakhir untuk ditampilkan di UI Dashboard dan menyediakan fitur tembak ulang (*re-trigger*) transaksi tertentu ke HP dari layar web.

---

## 6. Spesifikasi UI Layer: Dashboard Log & HealthCheck

Halaman UI berada di `src/app/dashboard/page.tsx` dan dirancang dengan antarmuka **Dark Mode Telemetry** yang responsif di layar HP maupun desktop.

### 6.1. Komponen Utama UI Layer

1. **Top Bar & Quick Action:**
   * Indikator status sistem secara keseluruhan (`SYSTEM HEALTHY` / `DEGRADED`).
   * Tombol **`[⚡ Test Ping ke HP]`** untuk mengetes apakah MacroDroid di HP sedang aktif menerima sinyal.
   * Tombol **`[📥 Export Backup .XLSX]`** jika sewaktu-waktu Anda ingin mengunduh riwayat log dari Redis menjadi file Excel berformat Realbyte $11$ kolom.
2. **4 Kartu Metrik HealthCheck (Grid $4$ Kolom):**
   * **Vercel & Hono Runtime:** Status `ONLINE`, Region (`sin1 - Singapore`), rata-rata waktu respons API.
   * **Gemini 2.5 Flash Engine:** Status koneksi AI, rata-rata *latency* ekstraksi (misal: $890\text{ ms}$), rasio filter iklan/promo.
   * **Telegram Bot Webhook:** Status koneksi Bot, jumlah antrean pesan (`0 pending`).
   * **MacroDroid Device Sync:** Waktu terakhir HP aktif (*Last Seen*), persentase keberhasilan *UI Automation*.
3. **Interactive Log Table & Filter Bar:**
   * **Filter Tabs:** `Semua Log`, `Tercatat (Expense/Income)`, `Menunggu Layar HP Dibuka`, `Diblokir (Iklan/OTP)`, `Gagal`.
   * **Baris Tabel:** Menampilkan waktu (`HH:mm:ss`), *Badge* aplikasi asal (`Jago`, `Blu`, `ShopeePay`, `OCR`), cuplikan teks asli, hasil pemetaan AI (`Account` | `Category > Subcategory` | `Rp Nominal`), status sinkronisasi HP, dan tombol **`[🔄 Retry]`**.

---

## 7. Struktur Direktori Proyek & Environment Variables

```text
mm-autosync-service/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── [[...route]]/
│   │   │       └── route.ts        # Hono API (Webhook Telegram, MacroDroid, Health, Logs)
│   │   ├── dashboard/
│   │   │   └── page.tsx            # UI Dashboard (HealthCheck Cards & Live Log Table)
│   │   ├── layout.tsx
│   │   └── page.tsx                # Halaman Login PIN Sederhana / Redirect ke Dashboard
│   ├── lib/
│   │   ├── gemini.ts               # Wrapper @google/genai + System Prompt Pola User
│   │   ├── redis.ts                # Helper Upstash Redis (Save Log, Get Logs, Heartbeat)
│   │   ├── macrodroid.ts           # Helper Trigger Webhook MacroDroid ke HP
│   │   └── telegram.ts             # Helper Send Message, OCR File Fetcher & Callback
│   └── types/
│       └── enums.ts                # Seluruh Enum & VALID_HIERARCHY (Snippet Bab 3)
├── .env.example
├── package.json
├── tsconfig.json
└── tailwind.config.ts
```

### Konfigurasi `.env` di Vercel
```env
# 1. Gemini AI
GEMINI_API_KEY="AIzaSy..."

# 2. Telegram Bot
TELEGRAM_TOKEN="123456789:AAH..."
TELEGRAM_WEBHOOK_SECRET="secret-token-header-telegram"
ALLOWED_CHAT_ID="987654321"

# 3. MacroDroid Device Webhook
MACRODROID_WEBHOOK_URL="https://trigger.macrodroid.com/xxxx-xxxx/input_mm"
MACRODROID_SECRET="secret-token-macrodroid"

# 4. Upstash Redis (Untuk UI Log & HealthCheck)
UPSTASH_REDIS_REST_URL="https://xxxx.upstash.io"
UPSTASH_REDIS_REST_TOKEN="AXxx..."

# 5. Proteksi Halaman Dashboard Web
DASHBOARD_PASSCODE="123456"
```