import { z } from "zod";
import { Type, type Schema } from "@google/genai";

export const TransactionTypeEnum = z.enum(["Expense", "Income"]);
export type TransactionType = z.infer<typeof TransactionTypeEnum>;

export const CurrencyEnum = z.enum(["IDR"]);
export type CurrencyCode = z.infer<typeof CurrencyEnum>;

// Active and legacy account names preserved verbatim from Realbyte Money Manager
export const ActiveAccountEnum = z.enum([
  "Jago",
  "Cash",
  "Shopeepay",
  "Gopay",
  "Blu",
  "Mandiri",
  "BCA",
  "Rdn Stockbit",
  "Jago - Paylater",
  "Other",
]);
export type ActiveAccountName = z.infer<typeof ActiveAccountEnum>;

export const LegacyAccountEnum = z.enum(["Accounts", "Card"]);
export type LegacyAccountName = z.infer<typeof LegacyAccountEnum>;

export const AllAccountEnum = z.enum([
  ...ActiveAccountEnum.options,
  ...LegacyAccountEnum.options,
]);
export type AccountName = z.infer<typeof AllAccountEnum>;

// Spelling and casing preserved verbatim from Realbyte Money Manager (e.g. "Entertaiment", "Self-development", "Petty cash", "e-Commerce")
export const ExpenseCategoryEnum = z.enum([
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
]);
export type ExpenseCategory = z.infer<typeof ExpenseCategoryEnum>;

export const IncomeCategoryEnum = z.enum([
  "Other",
  "Investment",
  "Social",
  "Allowance",
  "THR",
  "Salary",
  "Part Time",
  "Bonus",
  "Petty cash",
]);
export type IncomeCategory = z.infer<typeof IncomeCategoryEnum>;

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
  "Petty cash",
]);
export type CategoryName = z.infer<typeof AllCategoryEnum>;

export const SubcategoryEnum = z.enum([
  "",
  "Daily",
  "Jajan",
  "Coffee",
  "Nongkrong",
  "Date FnB",
  "Transport Umum",
  "Bensin",
  "Bengkel",
  "Parkir",
  "Automotive Part",
  "Internet",
  "Self Need",
  "Fragrance",
  "Electronic",
  "Skin Care",
  "Top Up",
  "Movie",
  "Warnet",
  "Billiard",
  "TimeZone",
  "Apps",
  "Music",
  "Investment",
  "Book",
  "Laundry",
  "Shoes",
  "Clothing",
  "Friend",
  "Hangout",
  "Alumni",
  "Medicine",
  "Health",
  "Mama",
  "Rumah",
  "Feesible",
  "Shopee",
  "e-Commerce",
  "Outing",
  "SMBC",
  "AMFS",
  "BSI",
  "Monthly Allowance",
  "Stockbit",
  "Cashback",
  "Other",
]);
export type SubcategoryName = z.infer<typeof SubcategoryEnum>;

export const VALID_HIERARCHY: Record<
  TransactionType,
  Record<string, SubcategoryName[]>
> = {
  Expense: {
    Food: ["Daily", "Jajan", "Coffee", "Nongkrong", "Date FnB", ""],
    Transportation: [
      "Transport Umum",
      "Bensin",
      "Bengkel",
      "Parkir",
      "Automotive Part",
      "",
    ],
    "Social Life": ["Friend", "Hangout", "Alumni", ""],
    "Self Need": [
      "Internet",
      "Self Need",
      "Fragrance",
      "Electronic",
      "Skin Care",
      "",
    ],
    Other: ["Mama", "Rumah", "Feesible", ""],
    "Self-development": ["Investment", "Book", ""],
    Apparel: ["Laundry", "Shoes", "Clothing", ""],
    Paylater: [""],
    Entertaiment: [
      "Top Up",
      "Movie",
      "Warnet",
      "Billiard",
      "TimeZone",
      "Apps",
      "Music",
      "",
    ],
    Beauty: [""],
    Health: ["Medicine", "Health", ""],
    "Work Need": ["Outing", ""],
    Education: [""],
    Shopping: ["Shopee", "e-Commerce", ""],
    Gift: [""],
  },
  Income: {
    Other: ["Cashback", "Other", ""],
    Investment: ["Stockbit", ""],
    Social: [""],
    Allowance: ["SMBC", "AMFS", "BSI", "Monthly Allowance", ""],
    THR: [""],
    Salary: [""],
    "Part Time": [""],
    Bonus: [""],
    "Petty cash": [""],
  },
};

export interface SanitizedHierarchyResult {
  category: CategoryName;
  subcategory: SubcategoryName;
  wasAdjusted: boolean;
}

/**
 * Ensures Type -> Category -> Subcategory combinations match Money Manager hierarchy.
 */
export function sanitizeHierarchy(
  type: TransactionType,
  category: CategoryName | string,
  subcategory: SubcategoryName | string
): SanitizedHierarchyResult {
  const allowedCategories = Object.hasOwn(VALID_HIERARCHY, type)
    ? VALID_HIERARCHY[type]
    : VALID_HIERARCHY.Expense;

  // Use Object.hasOwn so prototype keys like "toString" never match as valid categories
  const validCategory: CategoryName = Object.hasOwn(allowedCategories, category)
    ? (category as CategoryName)
    : "Other";

  const allowedSubcategories = allowedCategories[validCategory] ?? [""];
  const validSubcategory: SubcategoryName = allowedSubcategories.includes(
    subcategory as SubcategoryName
  )
    ? (subcategory as SubcategoryName)
    : "";

  return {
    category: validCategory,
    subcategory: validSubcategory,
    wasAdjusted: validCategory !== category || validSubcategory !== subcategory,
  };
}

export function isValidHierarchy(
  type: TransactionType,
  category: string,
  subcategory: string
): boolean {
  if (!Object.hasOwn(VALID_HIERARCHY, type)) {
    return false;
  }
  const allowedCategories = VALID_HIERARCHY[type];
  if (!Object.hasOwn(allowedCategories, category)) {
    return false;
  }
  return allowedCategories[category].includes(subcategory as SubcategoryName);
}

export const GeminiResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    ignore: {
      type: Type.BOOLEAN,
      description:
        "Set true when the input is a promo, advertisement, OTP, login alert, or non-financial message.",
    },
    reason: {
      type: Type.STRING,
      description:
        "Brief explanation when ignore is true, or a short extraction summary.",
    },
    transactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            format: "enum",
            enum: [...TransactionTypeEnum.options],
          },
          account: {
            type: Type.STRING,
            format: "enum",
            enum: [...ActiveAccountEnum.options],
          },
          category: {
            type: Type.STRING,
            format: "enum",
            enum: [...AllCategoryEnum.options],
          },
          subcategory: {
            type: Type.STRING,
            format: "enum",
            enum: [...SubcategoryEnum.options],
          },
          amount: {
            type: Type.NUMBER,
            description: "Positive integer transaction amount in IDR.",
          },
          note: {
            type: Type.STRING,
            description:
              "Short lowercase note matching user history style, e.g. kopi kenangan, transjakarta, dari yudhis.",
          },
          description: {
            type: Type.STRING,
            description: "Optional extra detail, or empty string.",
          },
        },
        required: [
          "type",
          "account",
          "category",
          "subcategory",
          "amount",
          "note",
          "description",
        ],
      },
    },
  },
  required: ["ignore", "transactions"],
};
