import { serve } from "inngest/next";
import { functions, inngest } from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({ client: inngest, functions });
