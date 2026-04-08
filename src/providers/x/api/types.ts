export type XReferencedTweetType = "retweeted" | "quoted" | "replied_to";

export interface XReferencedTweet {
  id: string;
  type: XReferencedTweetType;
}

export interface XAttachment {
  media_keys?: string[];
}

export interface XNoteTweet {
  note_tweet_results?: {
    result?: {
      text?: string;
    };
  };
}

export interface XApiTweet {
  id: string;
  author_id?: string;
  created_at?: string;
  text?: string;
  referenced_tweets?: XReferencedTweet[];
  attachments?: XAttachment;
  in_reply_to_user_id?: string;
  note_tweet?: XNoteTweet;
}

export interface XApiUser {
  id: string;
  username?: string;
}

export interface XApiMediaVariant {
  url?: string;
  content_type?: string;
  bit_rate?: number;
}

export interface XApiMedia {
  media_key: string;
  type?: string;
  url?: string;
  preview_image_url?: string;
  variants?: XApiMediaVariant[];
}

export interface XApiIncludes {
  tweets?: XApiTweet[];
  users?: XApiUser[];
  media?: XApiMedia[];
}

export interface XApiUserLookupResponse {
  data?: XApiUser;
  errors?: Array<{ message?: string; detail?: string; title?: string }>;
}

export interface XApiUserTweetsResponse {
  data?: XApiTweet[];
  includes?: XApiIncludes;
  errors?: Array<{ message?: string; detail?: string; title?: string }>;
}
