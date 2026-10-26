export type PersonalRecordType = "meetings" | "reports" | "todos" | "orders";
export type SearchRecordType = PersonalRecordType | "documents" | "customers" | "files";
export interface WorkspaceRecord {
  id: string;
  type: SearchRecordType;
  title: string;
  summary: string;
  time: string;
  href: string;
}
export interface WorkspaceGroup {
  type: SearchRecordType;
  label: string;
  items: WorkspaceRecord[];
}
export interface PersonalFolder { id: number; name: string }
export interface FolderMembership { folder_id: number; record_type: PersonalRecordType; record_id: string }
export interface PersonalFile extends WorkspaceRecord { folder_id: number | null }
export interface PersonalWorkspace {
  groups: WorkspaceGroup[];
  folders: PersonalFolder[];
  memberships: FolderMembership[];
  files: PersonalFile[];
}
