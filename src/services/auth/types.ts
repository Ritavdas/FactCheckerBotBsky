export interface SessionData {
    did: string;
    handle: string;
    email?: string;
    accessJwt: string;
    refreshJwt: string;
}