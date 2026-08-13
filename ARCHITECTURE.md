# Sellkit POS - Architecture

This document describes the foundational architecture and data model of the Sellkit POS system.

## Stack Overview
- **Frontend**: Vite + React + TypeScript + Tailwind CSS (v4)
- **Backend**: Node.js + Express + TypeScript (API layer)
- **Database**: PostgreSQL (managed via Prisma ORM)

## Directory Structure
The repository is set up as a monorepo containing two main projects:
- `client/`: Contains the Vite frontend.
- `server/`: Contains the Express/Prisma backend.

## Data Model (PostgreSQL)

The database schema is robust and accounts for multi-store (outlet) setups, employee roles, variant-level products, and robust sales tracking.

### 1. Users & Roles
- **User**: Employees who log in. Each user is assigned a `Role` (Admin, Manager, Cashier). Users own Sales and TillReconciliations.

### 2. Organization & Locations
- **Outlet**: Represents a physical store or location.
- **Till**: Represents a cash register within an Outlet.

### 3. Inventory
- **Category**: Broad classification of products.
- **Product**: A base product item.
- **ProductVariant**: The specific sellable item (SKU, barcode). Useful for sizes, colors, or different pack sizes of the same product. Tracks `stockQuantity`, `price`, and `cost`.

### 4. Customers
- **Customer**: Patrons purchasing items. Tracks contact info and `loyaltyPoints`.

### 5. Sales & Transactions
- **Sale**: A single transaction. Tracks `receiptNumber`, `totalAmount`, `tax`, `discount`, and `isOfflineSync` (a flag to determine if it was created during an offline sync event).
- **SaleItem**: Individual lines on a receipt, linking a Sale to a ProductVariant.
- **PaymentSplit**: A single Sale can be paid using multiple payment methods (e.g., $10 Cash, $15 Card). The `PaymentMethod` enum tracks the type.

### 6. Shift Management
- **TillReconciliation**: Tracks a shift for a till. Captures the `openedAt`, `closedAt`, `openingFloat`, expected vs actual cash totals, and any `discrepancy`.
