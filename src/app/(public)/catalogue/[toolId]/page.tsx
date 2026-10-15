import { redirect } from "next/navigation";

import { routes } from "@/libs/routes";

/**
 * Old tool links (`/catalogue/search_web`) from before the live Explorer. The
 * app is a static export, so tool pages live at `/catalogue/view?tool=`; the
 * one path that was ever published is kept and sent there (the view resolves
 * a tool name as well as an id).
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ toolId: "search_web" }];
}

export default async function OldToolLink({ params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  redirect(routes.publicTool(decodeURIComponent(toolId)));
}
