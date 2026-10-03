import ApiClient from "@/libs/ApiClient";

/** The single client every service uses. */
export const api = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL);
