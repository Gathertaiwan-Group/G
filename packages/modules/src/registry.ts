export const MODULES = {
  subscriptions: {
    routes_to_gate: ["/subscriptions", "/admin/subscriptions", "/subscription-plans"],
    workers_to_skip: ["subscription-billing"],
    nav_items: ["subscribe", "admin/subscriptions"],
    mcp_tools: ["list_plans", "create_plan", "update_plan", "list_active_subscriptions", "cancel_subscription"],
    required_modules: ["payments"] as string[],
  },
  membership_tiers: {
    routes_to_gate: ["/admin/tiers", "/membership"],
    workers_to_skip: [],
    nav_items: ["membership", "admin/tiers"],
    mcp_tools: ["list_membership_tiers", "create_membership_tier", "assign_membership_tier"],
    required_modules: [],
  },
  campaigns: {
    routes_to_gate: ["/admin/campaigns", "/admin/coupons"],
    workers_to_skip: [],
    nav_items: ["admin/campaigns", "admin/coupons"],
    mcp_tools: ["list_campaigns", "create_campaign", "enable_campaign", "disable_campaign", "delete_campaign", "list_campaign_templates", "apply_campaign_template", "list_coupons", "create_coupon", "delete_coupon"],
    required_modules: [],
  },
  product_reviews: {
    routes_to_gate: ["/admin/reviews"],
    workers_to_skip: [],
    nav_items: ["admin/reviews"],
    mcp_tools: ["list_reviews", "moderate_review"],
    required_modules: [],
  },
  cms_posts: {
    routes_to_gate: ["/admin/posts", "/admin/post-categories", "/admin/post-tags", "/posts"],
    workers_to_skip: [],
    nav_items: ["blog", "admin/posts"],
    mcp_tools: ["list_posts", "create_post", "update_post", "publish_post", "delete_post"],
    required_modules: [],
  },
  site_notice: {
    routes_to_gate: [],
    workers_to_skip: [],
    nav_items: [],
    mcp_tools: ["update_site_notice"],
    required_modules: [],
  },
  member_only_products: {
    routes_to_gate: [],
    workers_to_skip: [],
    nav_items: [],
    mcp_tools: [],
    required_modules: ["membership_tiers"],
  },
  courses: {
    routes_to_gate: ["/courses", "/admin/courses"],
    workers_to_skip: [],
    nav_items: ["courses", "admin/courses"],
    mcp_tools: ["list_courses", "create_course", "publish_lesson"],
    required_modules: [],
  },
  crowdfunding: {
    routes_to_gate: ["/crowdfund", "/admin/crowdfund"],
    workers_to_skip: [],
    nav_items: ["crowdfund", "admin/crowdfund"],
    mcp_tools: ["list_crowdfund_projects", "create_crowdfund_project"],
    required_modules: ["payments"],
  },
  bookings: {
    routes_to_gate: ["/bookings", "/admin/bookings"],
    workers_to_skip: [],
    nav_items: ["bookings", "admin/bookings"],
    mcp_tools: ["list_booking_services", "create_booking_service"],
    required_modules: [],
  },
} as const

export type ModuleKey = keyof typeof MODULES
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[]
