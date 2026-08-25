-- Dual pricing discounts: separate discount for course-only vs course+books

ALTER TABLE course_book_pricing
    ADD COLUMN IF NOT EXISTS discount_without_books NUMERIC(12, 2)
        CHECK (discount_without_books IS NULL OR discount_without_books >= 0);

ALTER TABLE course_book_pricing
    ADD COLUMN IF NOT EXISTS discount_with_all_books NUMERIC(12, 2)
        CHECK (discount_with_all_books IS NULL OR discount_with_all_books >= 0);
