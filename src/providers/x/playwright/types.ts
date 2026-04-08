export interface RawUserLegacy {
  screen_name?: string;
}

export interface RawUserResult {
  legacy?: RawUserLegacy;
}

export interface RawTweetMedia {
  media_url_https?: string;
  media_url?: string;
}

export interface RawTweetLegacy {
  created_at?: string;
  full_text?: string;
  in_reply_to_status_id_str?: string | null;
  is_quote_status?: boolean;
  retweeted_status_result?: {
    result?: unknown;
  };
  entities?: {
    media?: RawTweetMedia[];
  };
  extended_entities?: {
    media?: RawTweetMedia[];
  };
}

export interface RawTweet {
  rest_id: string;
  legacy: RawTweetLegacy;
  core?: {
    user_results?: {
      result?: RawUserResult;
    };
  };
  quoted_status_result?: {
    result?: unknown;
  };
  retweeted_status_result?: {
    result?: unknown;
  };
}
