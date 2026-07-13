-- Fix auth_rls_initplan: wrap auth.uid() in (select auth.uid()) so Postgres evaluates
-- it once per statement instead of per row (Supabase linter recommendation).
-- Policies sourced from lib/supabase/migrations/create_company_memos_table.sql

DROP POLICY IF EXISTS "company_memos_insert_admin" ON company_memos;

CREATE POLICY "company_memos_insert_admin" ON company_memos
    FOR INSERT
    TO authenticated
    WITH CHECK (
        created_by = (select auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = (select auth.uid())
              AND u.role = 'ADMIN'
              AND u.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS "company_memos_update_authenticated" ON company_memos;

CREATE POLICY "company_memos_update_authenticated" ON company_memos
    FOR UPDATE
    TO authenticated
    USING (
        deleted_at IS NULL
        AND (
            EXISTS (
                SELECT 1 FROM public.users u
                WHERE u.id = (select auth.uid())
                  AND u.role = 'ADMIN'
                  AND u.deleted_at IS NULL
            )
            OR created_by = (select auth.uid())
            OR (
                NOT only_creator_can_edit
                AND EXISTS (
                    SELECT 1 FROM public.users u
                    WHERE u.id = (select auth.uid())
                      AND u.deleted_at IS NULL
                )
            )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = (select auth.uid())
              AND u.role = 'ADMIN'
              AND u.deleted_at IS NULL
        )
        OR created_by = (select auth.uid())
        OR (
            NOT only_creator_can_edit
            AND EXISTS (
                SELECT 1 FROM public.users u
                WHERE u.id = (select auth.uid())
                  AND u.deleted_at IS NULL
            )
        )
    );
