export interface Logger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
  debug?: (msg: string) => void;
}

export interface TIMInboundMessage {
  conversation_id: string;
  message_id: string;
  msg_seq: string;
  from_user_id: string;
  to_user_id: string;
  msg_type: 0 | 1 | 2 | 3;
  content: TIMMessageContent;
  create_at: number;
  raw_payload: unknown;
}

export interface TIMMessageContent {
  text?: string;
  msg?: string;
  image_url?: string;
  image_file_id?: string;
  voice_url?: string;
  voice_file_id?: string;
  voice_duration?: number;
  voice_ext?: string;
  video_url?: string;
  video_file_id?: string;
  video_duration?: number;
  video_size?: number;
  file_id?: string;
  url?: string;
  ext?: string;
  size?: number;
  runtime?: number;
  im_conversation_id?: string;
  id_temp?: string;
  user_name?: string;
}

export interface MVPConfig {
  tim_sdk_app_id: number;
  tim_user_id: string;
  tim_user_sig: string;
  debug?: boolean;
}

export interface MessageLogEntry {
  timestamp: string;
  direction: "IN" | "OUT" | "ERROR";
  user_id: string;
  content: string;
  status: string;
  message_id?: string;
}
