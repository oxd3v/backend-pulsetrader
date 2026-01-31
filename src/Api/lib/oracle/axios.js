import axios from "axios";

export async function axiosRequest({
  url,
  method = "GET",
  headers = {},
  params = {},
  data = {}
}) {
  const response = await axios({
    url,
    method,
    headers,
    params,
    data
  });
  return response.data;
}
