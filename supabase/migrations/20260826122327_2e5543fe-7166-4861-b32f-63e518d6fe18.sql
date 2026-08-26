CREATE TABLE public.teacher_passwords (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_password text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teacher_passwords TO authenticated;
GRANT ALL ON public.teacher_passwords TO service_role;

ALTER TABLE public.teacher_passwords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage teacher passwords"
ON public.teacher_passwords
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));