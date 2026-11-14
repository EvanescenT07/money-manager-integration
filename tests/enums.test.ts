import { describe, expect, it } from "bun:test";
import {
  ActiveAccountEnum,
  AllAccountEnum,
  AllCategoryEnum,
  CurrencyEnum,
  ExpenseCategoryEnum,
  GeminiResponseSchema,
  IncomeCategoryEnum,
  LegacyAccountEnum,
  SubcategoryEnum,
  TransactionTypeEnum,
  VALID_HIERARCHY,
  isValidHierarchy,
  sanitizeHierarchy,
  type TransactionType,
} from "../src/types/enums";

describe("Money Manager Enums & Hierarchy", () => {
  it("preserves exact typo-preserved category and subcategory spellings", () => {
    expect(ExpenseCategoryEnum.safeParse("Entertaiment").success).toBe(true);
    expect(ExpenseCategoryEnum.safeParse("Entertainment").success).toBe(false);
    expect(AllCategoryEnum.safeParse("Entertaiment").success).toBe(true);
    expect(AllCategoryEnum.safeParse("Entertainment").success).toBe(false);

    expect(ExpenseCategoryEnum.safeParse("Self-development").success).toBe(true);
    expect(ExpenseCategoryEnum.safeParse("Self-Development").success).toBe(false);
    expect(ExpenseCategoryEnum.safeParse("Self development").success).toBe(false);

    expect(IncomeCategoryEnum.safeParse("Petty cash").success).toBe(true);
    expect(IncomeCategoryEnum.safeParse("Petty Cash").success).toBe(false);

    expect(SubcategoryEnum.safeParse("e-Commerce").success).toBe(true);
    expect(SubcategoryEnum.safeParse("E-Commerce").success).toBe(false);
    expect(SubcategoryEnum.safeParse("e-commerce").success).toBe(false);
  });

  it("includes exact active and legacy account names", () => {
    const expectedActive = [
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
    ];
    expect(ActiveAccountEnum.options).toEqual(expectedActive);
    expect(LegacyAccountEnum.options).toEqual(["Accounts", "Card"]);
    expect(AllAccountEnum.options).toEqual([...expectedActive, "Accounts", "Card"]);

    expect(ActiveAccountEnum.safeParse("Rdn Stockbit").success).toBe(true);
    expect(ActiveAccountEnum.safeParse("Jago - Paylater").success).toBe(true);
    expect(ActiveAccountEnum.safeParse("Accounts").success).toBe(false);
    expect(AllAccountEnum.safeParse("Accounts").success).toBe(true);
    expect(AllAccountEnum.safeParse("Card").success).toBe(true);
  });

  it("includes IDR currency, both transaction types, and all 46 subcategory options", () => {
    expect(TransactionTypeEnum.options).toEqual(["Expense", "Income"]);
    expect(CurrencyEnum.options).toEqual(["IDR"]);
    expect(SubcategoryEnum.options).toHaveLength(46);
    expect(SubcategoryEnum.options[0]).toBe("");
    expect(SubcategoryEnum.options).toContain("Date FnB");
    expect(SubcategoryEnum.options).toContain("Automotive Part");
    expect(SubcategoryEnum.options).toContain("Feesible");
    expect(SubcategoryEnum.options).toContain("Monthly Allowance");
    expect(SubcategoryEnum.options).toContain("Stockbit");
    expect(SubcategoryEnum.options).toContain("Cashback");
  });

  it("keeps VALID_HIERARCHY synchronized with Expense and Income category enums", () => {
    const expenseKeys = Object.keys(VALID_HIERARCHY.Expense);
    const incomeKeys = Object.keys(VALID_HIERARCHY.Income);

    expect(expenseKeys.sort()).toEqual([...ExpenseCategoryEnum.options].sort());
    expect(incomeKeys.sort()).toEqual([...IncomeCategoryEnum.options].sort());

    for (const type of TransactionTypeEnum.options) {
      for (const [category, subs] of Object.entries(VALID_HIERARCHY[type])) {
        expect(AllCategoryEnum.safeParse(category).success).toBe(true);
        expect(subs).toContain("");
        for (const sub of subs) {
          expect(SubcategoryEnum.safeParse(sub).success).toBe(true);
        }
      }
    }
  });

  it("enforces Investment Income vs Expense separation and Cashback Income rule", () => {
    expect(isValidHierarchy("Income", "Investment", "Stockbit")).toBe(true);
    expect(isValidHierarchy("Income", "Investment", "")).toBe(true);
    expect(isValidHierarchy("Income", "Self-development", "Investment")).toBe(false);

    expect(isValidHierarchy("Expense", "Self-development", "Investment")).toBe(true);
    expect(isValidHierarchy("Expense", "Self-development", "Book")).toBe(true);
    expect(isValidHierarchy("Expense", "Investment", "Stockbit")).toBe(false);

    expect(isValidHierarchy("Income", "Other", "Cashback")).toBe(true);
    expect(isValidHierarchy("Income", "Other", "Other")).toBe(true);
    expect(isValidHierarchy("Expense", "Other", "Cashback")).toBe(false);
    expect(isValidHierarchy("Expense", "Other", "Feesible")).toBe(true);
  });

  it("sanitizes valid and invalid hierarchy combinations accurately", () => {
    expect(sanitizeHierarchy("Expense", "Entertaiment", "Movie")).toEqual({
      category: "Entertaiment",
      subcategory: "Movie",
      wasAdjusted: false,
    });

    expect(sanitizeHierarchy("Expense", "Food", "Stockbit")).toEqual({
      category: "Food",
      subcategory: "",
      wasAdjusted: true,
    });

    expect(sanitizeHierarchy("Expense", "Salary", "Coffee")).toEqual({
      category: "Other",
      subcategory: "",
      wasAdjusted: true,
    });

    expect(sanitizeHierarchy("Income", "Food", "Cashback")).toEqual({
      category: "Other",
      subcategory: "Cashback",
      wasAdjusted: true,
    });

    expect(sanitizeHierarchy("Expense", "Shopping", "e-Commerce")).toEqual({
      category: "Shopping",
      subcategory: "e-Commerce",
      wasAdjusted: false,
    });
  });

  it("blocks prototype chain pollution keys in sanitizeHierarchy and isValidHierarchy", () => {
    const prototypeKeys = [
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
    ];

    for (const key of prototypeKeys) {
      expect(isValidHierarchy("Expense", key, "")).toBe(false);
      expect(isValidHierarchy("Income", key, "")).toBe(false);
      expect(sanitizeHierarchy("Expense", key, "")).toEqual({
        category: "Other",
        subcategory: "",
        wasAdjusted: true,
      });
      expect(sanitizeHierarchy("Income", key, "Cashback")).toEqual({
        category: "Other",
        subcategory: "Cashback",
        wasAdjusted: true,
      });
    }

    expect(isValidHierarchy("toString" as TransactionType, "Food", "Daily")).toBe(
      false
    );
    expect(
      sanitizeHierarchy("toString" as TransactionType, "Food", "Daily")
    ).toEqual({
      category: "Food",
      subcategory: "Daily",
      wasAdjusted: false,
    });
  });

  it("restricts GeminiResponseSchema account enum to ActiveAccountEnum", () => {
    const txItems = GeminiResponseSchema.properties?.transactions?.items;
    expect(txItems).toBeDefined();
    expect(txItems?.properties?.account?.enum).toEqual([
      ...ActiveAccountEnum.options,
    ]);
    expect(txItems?.properties?.account?.enum).not.toContain("Accounts");
    expect(txItems?.properties?.account?.enum).not.toContain("Card");
    expect(GeminiResponseSchema.required).toEqual(["ignore", "transactions"]);
  });
});
